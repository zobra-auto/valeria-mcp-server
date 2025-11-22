import express from 'express';
import Ajv from 'ajv';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { nowISO } from '../utils/time.js';
import * as calendar from '../tools/calendar.js';
import * as docs from '../tools/docs.js';
import * as availability from '../tools/availability.js';
import * as notifier from '../tools/notifier.js';
import * as catalog from '../tools/catalog.js'; 
import * as booking from '../tools/booking.js';   
import cache from '../utils/cache.js';
import * as barbers from '../tools/barbers.js';


const ajv = new Ajv({ removeAdditional: true, allErrors: true });
const schema = {
  type: 'object',
  required: ['tool', 'action'],
  properties: {
    tool: { type: 'string' },
    action: { type: 'string' },
    params: { type: 'object', additionalProperties: true }
  }
};
const validate = ajv.compile(schema);

const registry = {
  calendar,
  docs,
  ver_disponibilidad: availability,
  notificador: notifier,
  barbers,
  catalog,
  booking,
};

export const mcpRouter = express.Router();

// Configuration from env
const API_KEY = process.env.API_KEY || '';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || process.env.CACHE_TTL_SECONDS || 120);
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE || 60);

// Simple in-memory rate limiter (per-key). For production use Redis.
const rateWindows = new Map();

function timingSafeCompare(a, b) {
  try {
    const aBuf = Buffer.from(String(a));
    const bBuf = Buffer.from(String(b));
    if (aBuf.length !== bBuf.length) {
      const pad = Buffer.alloc(Math.abs(aBuf.length - bBuf.length));
      if (aBuf.length < bBuf.length) return crypto.timingSafeEqual(Buffer.concat([aBuf, pad]), bBuf) && false;
      return crypto.timingSafeEqual(aBuf, Buffer.concat([bBuf, pad])) && false;
    }
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch (e) {
    return false;
  }
}

function normalizeError(e) {
  if (!e) return { code: 'ERROR', message: 'Unknown error', status: 500, raw: e };
  if (e instanceof Error) {
    return {
      code: e.code || (e.name ? e.name.toUpperCase() : 'ERROR'),
      message: e.message || String(e),
      status: e.status || e.statusCode || (e.response && e.response.status),
      raw: e,
    };
  }
  if (typeof e === 'object') {
    return {
      code: e.code || 'ERROR',
      message: e.message || JSON.stringify(e),
      status: e.status || e.statusCode,
      raw: e,
    };
  }
  return { code: 'ERROR', message: String(e), status: undefined, raw: e };
}

function maskParams(params) {
  if (!params || typeof params !== 'object') return params;
  const out = {};
  Object.keys(params).forEach((k) => {
    const v = params[k];
    if (k.toLowerCase().includes('key') || k.toLowerCase().includes('token') || k.toLowerCase().includes('password') || k.toLowerCase().includes('private')) {
      out[k] = '***masked***';
    } else if (typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}...`;
    } else {
      out[k] = v;
    }
  });
  return out;
}

function rateAllow(apiKey) {
  if (!RATE_LIMIT_PER_MINUTE || RATE_LIMIT_PER_MINUTE <= 0) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  const windowSec = 60;
  const w = rateWindows.get(apiKey) || { windowStart: nowSec, count: 0 };
  if (nowSec - w.windowStart >= windowSec) {
    w.windowStart = nowSec;
    w.count = 1;
    rateWindows.set(apiKey, w);
    return true;
  }
  if (w.count >= RATE_LIMIT_PER_MINUTE) return false;
  w.count += 1;
  rateWindows.set(apiKey, w);
  return true;
}

mcpRouter.post('/', async (req, res) => {
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const incomingApiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '') || '';

  const authorized = API_KEY ? timingSafeCompare(API_KEY, incomingApiKey) : true;
  if (!authorized) {
    try { logger?.warn?.('MCP_AUTH_FAIL', { requestId, ip: req.ip }); } catch (e) {}
    return res.status(401).json({ status: 'error', error: 'UNAUTHORIZED', message: 'Invalid API key' });
  }

  if (!rateAllow(incomingApiKey || 'anon')) {
    try { logger?.warn?.('MCP_RATE_LIMIT', { requestId, ip: req.ip }); } catch (e) {}
    return res.status(429).json({ status: 'error', error: 'RATE_LIMIT', message: 'Rate limit exceeded' });
  }

  const body = req.body || {};
  if (!validate(body)) return res.status(400).json({ status: 'error', message: 'JSON inválido', errors: validate.errors });
  const { tool, action, params = {} } = body;
  logger.info({ requestId, tool, action }, 'mcp.request');

  // Health check
  if (tool === 'health' && action === 'ping') {
    return res.json({ status: 'ok', data: { pong: true, now_bogota: nowISO() } });
  }

  // --- RESOLUCIÓN DE TOOL + ACTION (reemplaza tu bloque desde aquí) ---
const mod = registry[tool];
if (!mod) {
  return res.status(404).json({ status: 'error', message: `Tool desconocida: ${tool}` });
}

// Soporta ambas formas: actions.create/cancel O funciones directas en el módulo
const handler =
  (mod.actions && typeof mod.actions[action] === 'function')
    ? (p) => mod.actions[action]({ params: p })   // calendar.js exporta { actions:{ create, cancel } }
    : (typeof mod[action] === 'function' ? mod[action] : null); // otras tools con export directo

if (!handler) {
  return res.status(404).json({ status: 'error', message: `Acción desconocida: ${action}` });
}

try {
  const data = await handler(params);
  // Normaliza la respuesta: si la tool devuelve { ok:true, data }, extrae data; si no, devuelve tal cual.
  const payload = (data && data.ok === true && data.data) ? data.data : data;
  return res.json({ status: 'ok', message: 'OK', data: payload });
} catch (err) {
  // Mapeo de errores semánticos (opcional pero recomendado)
  const code = err.code;
  const http =
    code === 'EVENT_NOT_FOUND' || code === 'BARBER_NOT_FOUND' || code === 'MISSING_CALENDAR' ? 404 :
    code === 'INVALID_WHEN' || code === 'IN_PAST' || code === 'GOOGLE_403_FORBIDDEN' ? 400 :
    500;

  logger?.error?.({ err, tool, action }, 'mcp.tool_error');
  return res.status(http).json({ status: 'error', code, message: err.message || 'Error' });
}

  if (typeof handler !== 'function') return res.status(404).json({ status: 'error', message: `Acción desconocida: ${action}` });

  // Optional validator
  try {
    const validator = (mod.schemas && mod.schemas[action]) || handler.validate;
    if (typeof validator === 'function') {
      const validationResult = validator(params);
      if (validationResult && typeof validationResult.then === 'function') await validationResult;
    }
  } catch (validationErr) {
    const ve = normalizeError(validationErr);
    logger?.info?.('MCP_VALIDATION_FAIL', { requestId, tool, action, error: ve.code, message: ve.message, params: maskParams(params) });
    const status = ve.status || 400;
    const safeMessage = (status === 500) ? 'Validation failed' : ve.message;
    return res.status(status).json({ status: 'error', error: ve.code || 'INVALID_PARAMS', message: safeMessage });
  }

  const deterministicKey = params && params.client_request_id ? `mcp:resp:${tool}:${action}:id:${params.client_request_id}` : `mcp:resp:${tool}:${action}:hash:${crypto.createHash('sha256').update(JSON.stringify(params || {})).digest('hex')}`;

  try {
    if (CACHE_TTL_SECONDS > 0) {
      try {
        const cached = await cache.get(deterministicKey);
        if (cached) {
          logger?.info?.('MCP_RESPONSE_CACHED', { requestId, tool, action });
          if (!res.headersSent) return res.json({ status: 'ok', message: 'OK', data: cached, fromCache: true });
        }
      } catch (err) {
        logger?.warn?.('MCP_CACHE_GET_FAIL', { requestId, tool, action, message: String(err) });
      }
    }

    const result = await handler({ params, meta: { requestId } });

    const normalized = (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) ? result : { ok: true, data: result };

    try {
      if (CACHE_TTL_SECONDS > 0 && normalized && normalized.ok) {
        await cache.set(deterministicKey, normalized.data, CACHE_TTL_SECONDS);
      }
    } catch (cacheErr) {
      logger?.warn?.('MCP_CACHE_FAIL', { requestId, tool, action, message: String(cacheErr) });
    }

    if (res.headersSent) return;
    return res.json({ status: 'ok', message: 'OK', data: normalized.data });
  } catch (rawErr) {
    const err = normalizeError(rawErr);
    const mappedStatus =
      err.code === 'GOOGLE_403_FORBIDDEN' ? 403 :
      err.code === 'EVENT_NOT_FOUND' || err.code === 'BARBER_NOT_FOUND' ? 404 :
      err.code === 'INVALID_WHEN' || err.code === 'IN_PAST' || err.code === 'INVALID_PARAMS' || err.code === 'MISSING_CALENDAR' ? 400 :
      err.status || 500;

    try {
      logger?.error?.('MCP_HANDLER_ERROR', {
        requestId,
        tool,
        action,
        code: err.code,
        message: err.message,
        params: maskParams(params),
        raw: err.raw && err.raw.stack ? err.raw.stack : undefined,
      });
    } catch (logErr) {
      console.error('MCP logger failed', logErr);
    }

    const safeMessage = (mappedStatus === 500) ? 'Internal server error' : err.message;
    if (!res.headersSent) return res.status(mappedStatus).json({ status: 'error', error: err.code || 'ERROR', message: safeMessage });
    return;
  }
});

