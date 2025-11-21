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
    // quita caracteres de reemplazo '�' que aparecen por problemas de encoding
    .replace(/\uFFFD/g, '')
    .normalize('NFD')          // quita tildes
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')      // colapsa espacios múltiples
    .trim();
}
/**
 * Distancia de Levenshtein simple para permitir 1 error
 */
function levenshtein(a, b) {
  const s = a || '';
  const t = b || '';
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      if (s[i - 1] === t[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = Math.min(
          prev + 1,   // sustitución
          dp[j] + 1,  // borrado
          dp[j - 1] + 1 // inserción
        );
      }
      prev = temp;
    }
  }

  return dp[n];
}

/**
 * Comparación "suave": exacto, substring o distancia <= 1
 */
function looseMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const dist = levenshtein(a, b);
  return dist <= 1;
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

    // 1) displayName coincide (exacto o casi igual)
    if (looseMatch(inputN, display)) {
      matches.push({ barber_id: barberId, displayName: cfg.displayName });
      continue;
    }

    // 2) alias coincide (exacto o casi igual)
    if (aliases.some((a) => looseMatch(inputN, a))) {
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
