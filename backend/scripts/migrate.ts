import { readdirSync, readFileSync } from 'node:fs';
import { pool, withTx } from '../src/db.js';

const dir = new URL('../../database/migrations/', import.meta.url);
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  await withTx(async (c) => {
    await c.query(readFileSync(new URL(f, dir), 'utf8'));
    await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
  });
  console.log('applied', f);
}
console.log('migrations up to date');
await pool.end();