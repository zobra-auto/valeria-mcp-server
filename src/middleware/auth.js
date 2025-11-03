import { config } from '../config.js';

export function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!config.apiKey) return res.status(500).json({ status: 'error', message: 'API_KEY no configurada' });
  if (token !== config.apiKey) return res.status(401).json({ status: 'error', message: 'No autorizado' });
  next();
}
