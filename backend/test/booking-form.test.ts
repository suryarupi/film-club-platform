import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.TICKET_HMAC_SECRET ??= 'test-secret-test-secret-test-secret-123';
if (!/test/.test(process.env.DATABASE_URL ?? '')) throw new Error('Refusing to run: DATABASE_URL must contain "test" (schema is wiped).');

const { pool } = await import('../src/db.js');
const { buildApp } = await import('../src/app.js');
const migrations = ['001_init.sql', '002_sessions.sql'].map((f) => readFileSync(new URL(`../../database/migrations/${f}`, import.meta.url), 'utf8'));
let app: Awaited<ReturnType<typeof buildApp>>;
let screening: string, seatIds: string[];

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const m of migrations) await pool.query(m);
  app = await buildApp({ logger: false, rateLimits: false });
  const venue = (await pool.query(`INSERT INTO venues (name) VALUES ('Hall') RETURNING id`)).rows[0]!.id;
  for (let c = 0; c < 4; c++)
    await pool.query(`INSERT INTO seats (venue_id,row_label,seat_label,grid_x,grid_y) VALUES ($1,'A',$2,$3,0)`, [venue, `A${c + 1}`, c]);
  screening = (await pool.query(
    `INSERT INTO screenings (film_name,venue_id,starts_at,ends_at,booking_opens_at,booking_closes_at,status)
     VALUES ('Film',$1, now()+interval '2 days', now()+interval '2 days 3 hours', now()-interval '1 hour', now()+interval '1 day','SCHEDULED') RETURNING id`, [venue])).rows[0]!.id;
  seatIds = (await pool.query(`SELECT id FROM seats WHERE venue_id=$1 ORDER BY seat_label`, [venue])).rows.map((r) => r.id);
  await pool.query(
    `INSERT INTO form_fields (screening_id, field_key, label, field_type, required, validation, sort_order) VALUES
       ($1,'phone','Phone','phone',false,'{"pattern":"^[0-9]{10}$"}',0), ($1,'year','Year','select',true,'{"options":["1","2","3","4"]}',1)`, [screening]);
});
afterAll(async () => { await app.close(); await pool.end(); });

const book = (seat: number, formData: object) =>
  app.inject({ method: 'POST', url: '/api/bookings', headers: { 'idempotency-key': randomUUID() },
    payload: { screeningId: screening, seatIds: [seatIds[seat]], student: { rollNumber: `R${seat}${Date.now() % 1000}`, department: 'CSE' }, formData } });

describe('admin-configured form fields are enforced by the server', () => {
  it('rejects a missing required field', async () => {
    const r = await book(0, { phone: '9876543210' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatchObject({ code: 'INVALID_FORM' });
    expect(r.json().error.message).toContain('Year');
  });
  it('rejects an option that is not in the list', async () => {
    expect((await book(0, { year: '9' })).json().error.code).toBe('INVALID_FORM');
  });
  it('rejects a value that breaks the pattern', async () => {
    const r = await book(0, { year: '2', phone: '123' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain('Phone');
  });
  it('accepts valid answers, trims them, and drops unknown keys', async () => {
    const r = await book(1, { year: ' 2 ', phone: '9876543210', hack: '<script>' });
    expect(r.statusCode).toBe(201);
    const { rows } = await pool.query(`SELECT form_data FROM bookings WHERE id = $1`, [r.json().bookingId]);
    expect(rows[0].form_data).toEqual({ year: '2', phone: '9876543210' });
  });
});
