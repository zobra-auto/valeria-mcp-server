import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const BARBERS_JSON_PATH =
  process.env.BARBERS_JSON || path.join(process.cwd(), 'data', 'barbers.json');

/**
 * Carga y cachea el archivo barbers.json
 */
let barbersCache = null;

function loadBarbers() {
  if (barbersCache) return barbersCache;

  try {
    if (!fs.existsSync(BARBERS_JSON_PATH)) {
      logger.error?.('BARBERS_JSON_NOT_FOUND', { path: BARBERS_JSON_PATH });
      barbersCache = {};
      return barbersCache;
    }

    const raw = fs.readFileSync(BARBERS_JSON_PATH, 'utf8').trim();
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      logger.error?.('BARBERS_JSON_INVALID');
      barbersCache = {};
      return barbersCache;
    }

    barbersCache = parsed;
  } catch (err) {
    logger.error?.('BARBERS_JSON_LOAD_ERROR', {
      message: err.message,
      stack: err.stack,
    });
    barbersCache = {};
  }

  return barbersCache;
}

/**
 * Normaliza texto para comparación
 */
function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')          // quita tildes
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Resolver barbero:
 * - Si el nombre coincide con displayName → OK
 * - Si coincide con alias → OK
 * - Si coincide con llave técnica → ERROR BARBER_INTERNAL_ID_USED
 * - Si coincide con varios → ERROR BARBER_AMBIGUOUS
 * - Si no coincide con nada → ERROR BARBER_NOT_FOUND
 */
async function resolveBarber(params) {
  const name = params?.name;

  if (!name) {
    return {
      ok: false,
      error: {
        code: 'BARBER_PARAM_MISSING',
        message: 'Debe proporcionar un nombre.',
      },
    };
  }

  const inputN = normalize(name);
  const barbers = loadBarbers();

  const matches = [];
  let internalIdMatch = null;

  for (const barberId of Object.keys(barbers)) {
    const cfg = barbers[barberId];

    const display = normalize(cfg.displayName);
    const aliases = Array.isArray(cfg.aliases)
      ? cfg.aliases.map((a) => normalize(a))
      : [];

    // 1) displayName coincide EXACTO
    if (inputN === display) {
      matches.push({ barber_id: barberId, displayName: cfg.displayName });
      continue;
    }

    // 2) alias coincide
    if (aliases.includes(inputN)) {
      matches.push({ barber_id: barberId, displayName: cfg.displayName });
      continue;
    }

    // 3) coincide con ID interno → error especial
    if (inputN === normalize(barberId)) {
      internalIdMatch = barberId;
    }
  }

  // ⚠ Si coincide con ID interno pero NO con nombre visible → error
  if (internalIdMatch && matches.length === 0) {
    return {
      ok: false,
      error: {
        code: 'BARBER_INTERNAL_ID_USED',
        message: `El nombre "${name}" coincide con un identificador interno, no con un nombre visible.`,
        internal_id: internalIdMatch,
      },
    };
  }

  // 0 coincidencias
  if (matches.length === 0) {
    return {
      ok: false,
      error: {
        code: 'BARBER_NOT_FOUND',
        message: `No se encontró ningún barbero llamado "${name}".`,
      },
    };
  }

  // Más de una coincidencia → ambiguo
  if (matches.length > 1) {
    return {
      ok: false,
      error: {
        code: 'BARBER_AMBIGUOUS',
        message: `El nombre "${name}" coincide con varios barberos.`,
        options: matches,
      },
    };
  }

  // Coincidencia única → OK
  return {
    ok: true,
    data: matches[0],
  };
}

export const name = 'barbers';

export const actions = {
  async resolve({ params }) {
    return await resolveBarber(params);
  },
};
