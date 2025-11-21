// src/utils/logger.js
import pino from 'pino';
import { randomUUID } from 'crypto';

const isProd = process.env.NODE_ENV === 'production';

// Nivel de log por entorno (puedes sobreescribir con LOG_LEVEL)
const level =
  process.env.LOG_LEVEL ||
  (isProd ? 'info' : 'debug');

// Metadata base que aparecerá en TODOS los logs
const base = {
  service: 'valeria-mcp',
  env: process.env.NODE_ENV || 'development',
};

// Logger principal (stdout JSON, ideal para contenedores)
export const logger = pino({
  level,
  base,
  // timestamps ISO legibles
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    // en vez de level numérico, usamos la etiqueta (info, error, etc.)
    level(label) {
      return { level: label };
    },
    // bindings que se añaden automáticamente (pid, hostname, etc.)
    bindings(bindings) {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: base.service,
      };
    },
  },
});

/**
 * Crea un logger “hijo” ligado a un request/operación.
 * Ideal para calendar.check, calendar.create, barbers.resolve, etc.
 *
 * Ejemplo de uso:
 *   const log = createRequestLogger({ tool: 'calendar', action: 'check', barber: 'nova' });
 *   log.info({ from, to }, 'Checking availability');
 */
export function createRequestLogger(meta = {}) {
  const reqId = meta.reqId || randomUUID().slice(0, 8);

  const { tool, action, barber, ...rest } = meta;

  return logger.child({
    req_id: reqId,
    ...(tool && { tool }),
    ...(action && { action }),
    ...(barber && { barber }),
    ...rest,
  });
}

/**
 * Loguea una operación con duración (no-async).
 *
 * const start = Date.now();
 * ... lógica ...
 * logWithDuration(log, 'calendar.check completed', { slots: slots.length }, start);
 */
export function logWithDuration(log, message, extra = {}, startTimeMs) {
  const now = Date.now();
  const duration_ms = startTimeMs ? now - startTimeMs : 0;

  if (extra && typeof extra === 'object') {
    log.info({ ...extra, duration_ms }, message);
  } else {
    log.info({ duration_ms }, message);
  }
}

/**
 * Envuelve una función async y loguea duración + error si falla.
 *
 * await timeAsync(log, 'calendar.create', async () => {
 *   return await createEventInterno(params);
 * });
 */
export async function timeAsync(log, message, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    log.info({ duration_ms: Date.now() - start }, message);
    return result;
  } catch (err) {
    log.error(
      {
        err: {
          message: err.message,
          code: err.code,
          stack: err.stack,
        },
        duration_ms: Date.now() - start,
      },
      message,
    );
    throw err;
  }
}
