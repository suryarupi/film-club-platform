import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

for (const k of ['DATABASE_URL', 'TICKET_HMAC_SECRET'])
  if (!process.env[k]) { console.error(`Missing required env var ${k} (see .env.example)`); process.exit(1); }

const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const)
  process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });