import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import { auth } from './middleware/auth.js';
import { mcpRouter } from './mcp/router.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/health', (_, res) => res.json({ status: 'ok', env: config.env }));

app.use('/mcp', auth, mcpRouter);
app.use('/tools', auth, mcpRouter);

app.use((req, res) => res.status(404).json({ status: 'error', message: 'Ruta no encontrada' }));

app.listen(config.port, () => {
  console.log(`MCP server on :${config.port}`);
});
