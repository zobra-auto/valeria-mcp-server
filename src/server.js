import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config, barbers, businessHours } from './config.js';
import { auth } from './middleware/auth.js';
import { rateLimit } from './middleware/rate.js';
import { mcpRouter } from './mcp/router.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// health GET simple
app.get('/health', (_, res) => res.json({ status: 'ok', env: config.env }));

// Aplica auth + rate limit al contrato MCP
app.use('/mcp', auth, rateLimit, mcpRouter);
app.use('/tools', auth, rateLimit, mcpRouter);

// endpoint opcional para verificar carga de datos
app.get('/_debug/config', auth, (req, res) => {
  res.json({
    status: 'ok',
    tz: config.tz,
    cacheTtlSec: config.cacheTtlSec,
    ratePerMin: config.ratePerMin,
    barbersCount: barbers.length,
    hoursKeys: Object.keys(businessHours),
  });
});

app.use((req, res) => res.status(404).json({ status: 'error', message: 'Ruta no encontrada' }));

app.listen(config.port, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'server.started', port: config.port, tz: config.tz }));
});
