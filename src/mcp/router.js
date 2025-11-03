import express from 'express';
import Ajv from 'ajv';
import { logger } from '../utils/logger.js';
import * as calendar from '../tools/calendar.js';
import * as notion from '../tools/notion_catalog.js';
import * as docs from '../tools/docs.js';
import * as availability from '../tools/availability.js';
import * as notifier from '../tools/notifier.js';

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
  notion_catalog: notion,
  docs,
  ver_disponibilidad: availability,
  notificador: notifier,
};

export const mcpRouter = express.Router();

mcpRouter.post('/', async (req, res) => {
  const body = req.body || {};
  if (!validate(body)) return res.status(400).json({ status: 'error', message: 'JSON inválido', errors: validate.errors });
  const { tool, action, params = {} } = body;
  const mod = registry[tool];
  if (!mod) return res.status(404).json({ status: 'error', message: `Tool desconocida: ${tool}` });
  if (typeof mod[action] !== 'function') return res.status(404).json({ status: 'error', message: `Acción desconocida: ${action}` });
  try {
    const data = await mod[action](params);
    return res.json({ status: 'ok', message: 'OK', data });
  } catch (err) {
    logger.error({ err }, 'Fallo tool');
    return res.status(500).json({ status: 'error', message: err.message || 'Error interno' });
  }
});

mcpRouter.post('/:tool/:action', async (req, res) => {
  const { tool, action } = req.params;
  const params = req.body || {};
  const mod = registry[tool];
  if (!mod) return res.status(404).json({ status: 'error', message: `Tool desconocida: ${tool}` });
  if (typeof mod[action] !== 'function') return res.status(404).json({ status: 'error', message: `Acción desconocida: ${action}` });
  try {
    const data = await mod[action](params);
    return res.json({ status: 'ok', message: 'OK', data });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message || 'Error interno' });
  }
});
