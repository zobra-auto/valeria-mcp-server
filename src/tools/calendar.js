const { google } = require('googleapis');
const { DateTime } = require('luxon');
const path = require('path');
const fs = require('fs');

const cache = require('../utils/cache');
const logger = require('../utils/logger');

// -------------------- ENV --------------------
const TZ = process.env.TIMEZONE || 'America/Bogota';
const DEFAULT_DURATION_MIN = Number(process.env.DEFAULT_SLOT_MINUTES || 30);
const BARBERS_JSON_PATH = process.env.BARBERS_JSON || path.join(process.cwd(), 'data', 'barbers.json');

// -------------------- AUTH (Service Account) --------------------
function getAuthClient() {
  const keyfile = process.env.GOOGLE_SA_KEYFILE;
  const jsonInline = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const b64 = process.env.GOOGLE_SA_JSON_BASE64; // opcional

  let credentials;

  try {
    if (keyfile && fs.existsSync(keyfile)) {
      credentials = JSON.parse(fs.readFileSync(keyfile, 'utf8'));
    } else if (jsonInline) {
      credentials = JSON.parse(jsonInline);
    } else if (b64) {
      credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } else {
      const err = new Error('MISSING_GOOGLE_SA: Define GOOGLE_APPLICATION_CREDENTIALS_JSON o GOOGLE_SA_KEYFILE');
      err.code = 'MISSING_GOOGLE_SA';
      throw err;
    }
  } catch (err) {
    // Evitar loggear credenciales completas
    logger.error?.('GOOGLE_SA_PARSE_ERROR', { message: err.message });
    throw err;
  }

  // Validar campos necesarios
  if (!credentials || !credentials.client_email || !credentials.private_key) {
    const err = new Error('INVALID_GOOGLE_SA: missing client_email or private_key in credentials');
    err.code = 'INVALID_GOOGLE_SA';
    throw err;
  }

  // Normalizar newlines si la private_key vino por env var (ej. "\n")
  const privateKey = credentials.private_key.replace(/\\n/g, '\n');

  return new google.auth.JWT({
    email: credentials.client_email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

// -------------------- HELPERS --------------------
function loadBarbersMap() {
  try {
    if (!fs.existsSync(BARBERS_JSON_PATH)) return {};
    const raw = fs.readFileSync(BARBERS_JSON_PATH, 'utf8').trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (e) {
    // No loggear todo el error para evitar filtrar datos sensibles
    logger.error?.('BARBERS_JSON_READ_ERROR', { message: e.message });
    return {};
  }
}

function resolveCalendarId(params) {
  const { calendarId, barber } = params || {};
  if (calendarId) return calendarId;

  if (barber) {
    const map = loadBarbersMap();
    if (!map[barber]) {
      const err = new Error(`BARBER_NOT_FOUND: ${barber}`);
      err.code = 'BARBER_NOT_FOUND';
      throw err;
    }
    return map[barber];
  }

  const err = new Error('MISSING_CALENDAR: se requiere calendarId o barber');
  err.code = 'MISSING_CALENDAR';
  throw err;
}

function ensureFuture(whenISO) {
  const now = DateTime.now().setZone(TZ);
  // Parsear directamente en la zona configurada para evitar interpretaciones indeseadas
  const dt = DateTime.fromISO(whenISO, { zone: TZ });
  if (!dt.isValid) {
    const err = new Error(`INVALID_WHEN: ${whenISO}`);
    err.code = 'INVALID_WHEN';
    throw err;
  }
  // Rechazar tiempos en el pasado o iguales a "ahora"
  if (dt <= now) {
    const err = new Error('IN_PAST');
    err.code = 'IN_PAST';
    throw err;
  }
  return dt;
}

function toRFC3339(dt) {
  // Luxon toISO incluye offset por defecto; suprimir ms para una cadena más limpia
  return dt.setZone(TZ).toISO({ suppressMilliseconds: true });
}

async function withIdempotency(key, fn) {
  const cached = await cache.get(key);
  if (cached) return cached;

  // Nota: si tu cache tiene un "set if not exists" (SETNX) es mejor usarlo para evitar race conditions.
  const result = await fn();
  // guarda 24h — confirmar la unidad (minutos/segundos) en tu implementación de cache
  await cache.set(key, result, 24 * 60);
  return result;
}

// -------------------- CORE OPS --------------------
async function createEvent(params) {
  // params: { when: ISO, who: string, notes?: string, duration?: number, barber?: string, calendarId?: string, client_request_id?: string }
  const {
    when,
    who,
    notes = '',
    duration,
    barber,
    calendarId: explicitCalId,
    client_request_id,
  } = params || {};

  if (!when) throw new Error('Missing param: when');
  if (!who) throw new Error('Missing param: who');

  const calId = resolveCalendarId({ calendarId: explicitCalId, barber });

  // duración por defecto (validar numericidad de forma explícita)
  const durMin = Number.isFinite(Number(duration)) ? Number(duration) : DEFAULT_DURATION_MIN;

  // Validar 'when' y construir start/end según TZ
  const startDT = ensureFuture(when);
  const endDT = startDT.plus({ minutes: durMin });

  const summary = `Cita con ${who}`;
  const description = notes || '';

  const exec = async () => {
    const auth = getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const res = await calendar.events.insert({
      calendarId: calId,
      requestBody: {
        summary,
        description,
        start: { dateTime: toRFC3339(startDT), timeZone: TZ },
        end: { dateTime: toRFC3339(endDT), timeZone: TZ },
      },
    });

    const ev = res.data || {};
    return {
      id: ev.id,
      when: toRFC3339(startDT),
      start: ev.start?.dateTime || toRFC3339(startDT),
      end: ev.end?.dateTime || toRFC3339(endDT),
      who,
      notes: description,
    };
  };

  try {
    if (client_request_id) {
      return await withIdempotency(`calendar:create:${client_request_id}`, exec);
    }
    return await exec();
  } catch (e) {
    const status = e?.response?.status || e?.statusCode || e?.code;
    if (status === 403) {
      const err = new Error('GOOGLE_403_FORBIDDEN: comparte el calendario con la Service Account (permiso writer).');
      err.code = 'GOOGLE_403_FORBIDDEN';
      throw err;
    }
    // deja rastro útil pero evita exponer secretos
    logger.error?.('CALENDAR_CREATE_ERROR', {
      calId,
      who,
      when,
      code: e?.code,
      status,
      message: e?.message,
    });
    throw e;
  }
}

async function cancelEvent(params) {
  // params: { eventId: string, calendarId?: string, barber?: string }
  const { eventId, calendarId: explicitCalId, barber } = params || {};
  if (!eventId) throw new Error('Missing param: eventId');

  const calId = resolveCalendarId({ calendarId: explicitCalId, barber });

  try {
    const auth = getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: calId, eventId });

    return { id: eventId, cancelled: true };
  } catch (e) {
    const status = e?.response?.status || e?.statusCode || e?.code;
    if (status === 404) {
      const err = new Error('EVENT_NOT_FOUND');
      err.code = 'EVENT_NOT_FOUND';
      throw err;
    }
    if (status === 403) {
      const err = new Error('GOOGLE_403_FORBIDDEN: la Service Account no tiene permisos sobre este calendario.');
      err.code = 'GOOGLE_403_FORBIDDEN';
      throw err;
    }
    logger.error?.('CALENDAR_CANCEL_ERROR', { calId, eventId, code: e?.code, status, message: e?.message });
    throw e;
  }
}

// -------------------- DISPATCHER --------------------
module.exports = {
  name: 'calendar',
  actions: {
    // tool="calendar"; action="create" | "cancel"
    async create({ params }) {
      const data = await createEvent(params);
      return { ok: true, data };
    },
    async cancel({ params }) {
      const data = await cancelEvent(params);
      return { ok: true, data };
    },
  },
};