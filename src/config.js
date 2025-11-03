import dotenv from 'dotenv';
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  apiKey: process.env.API_KEY,
  webhookOutbox: process.env.WEBHOOK_OUTBOX_URL || null,
};
