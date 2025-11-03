import fetch from 'node-fetch';
import { config } from '../config.js';

export async function send({ to, message }) {
  if (!to || !message) throw new Error('Parámetros requeridos: to, message');
  if (!config.webhookOutbox) return { queued: true, to, message };
  const res = await fetch(config.webhookOutbox, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message })
  });
  const ok = res.ok;
  return { delivered: ok, to, message, status: res.status };
}

