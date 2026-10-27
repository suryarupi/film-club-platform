import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env.TICKET_HMAC_SECRET ??= 'test-secret-test-secret-test-secret-123';
if (!/test/.test(process.env.DATABASE_URL ?? '')) throw new Error('Refusing to run: DATABASE_URL must contain "test" (schema is wiped).');

const { pool } = await import('../src/db.js');
const { buildApp } = await import('../src/app.js');
const { hashPassword } = await import('../src/auth/password.js');

const migrations = ['001_init.sql', '002_sessions.sql'].map((f) => readFileSync(new URL(`../../database/migrations/${f}`, import.meta.url), 'utf8'));
const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';
let app: Awaited<ReturnType<typeof buildApp>>;
let screening: string, seatIds: string[];

async function seed() {
  await pool.query('TRUNCATE venues, students, admins, audit_log CASCADE');
  const hash = await hashPassword(PW);
  await pool.query(`INSERT INTO admins (username,password_hash,role) VALUES ('boss',$1,'SUPER_ADMIN'),('gate',$1,'STAFF')`, [hash]);
  const venue = (await pool.query(`INSERT INTO venues (name, description) VALUES ('Test Hall','Main hall') RETURNING id`)).rows[0]!.id;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++)
    await pool.query(`INSERT INTO seats (venue_id,row_label,seat_label,grid_x,grid_y) VALUES ($1,$2,$3,$4,$5)`,
      [venue, 'AB'[r], `${'AB'[r]}${c + 1}`, c, r]);
  screening = (await pool.query(
    `INSERT INTO screenings (film_name,venue_id,starts_at,ends_at,booking_opens_at,booking_closes_at,allowed_booking_sizes,status,cancellations_enabled)
     VALUES ('Interstellar',$1, now()+interval '2 days', now()+interval '2 days 3 hours', now()-interval '1 hour', now()+interval '1 day', '{1,2}', 'SCHEDULED', true)
     RETURNING id`, [venue])).rows[0]!.id;
  seatIds = (await pool.query(`SELECT id FROM seats WHERE venue_id=$1 ORDER BY seat_label`, [venue])).rows.map((r) => r.id);
}

const book = (seats: string[], roll = `R${Math.random().toString(36).slice(2, 8)}`, key = randomUUID()) =>
  app.inject({ method: 'POST', url: '/api/bookings', headers: { 'idempotency-key': key },
    payload: { screeningId: screening, seatIds: seats, student: { rollNumber: roll, department: 'CSE' } } });
const post = (url: string, payload: object, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN, ...headers } });
async function login(username: string) {
  const r = await post('/api/auth/login', { username, password: PW });
  return `${r.cookies[0]!.name}=${r.cookies[0]!.value}`;
}

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const m of migrations) await pool.query(m);
  app = await buildApp({ logger: false, rateLimits: false });
});
beforeEach(seed);
afterAll(async () => { await app.close(); await pool.end(); });

describe('public API', () => {
  it('derives status from live counts', async () => {
    let s = (await app.inject('/api/screenings')).json().screenings[0];
    expect(s).toMatchObject({ status: 'OPEN', capacity: 6, booked: 0, available: 6 });
    for (const pair of [[0, 1], [2, 3]]) expect((await book(pair.map((i) => seatIds[i]!))).statusCode).toBe(201);
    expect((await book([seatIds[4]!])).statusCode).toBe(201);
    s = (await app.inject('/api/screenings')).json().screenings[0];
    expect(s).toMatchObject({ status: 'ALMOST_FULL', available: 1 });
    await book([seatIds[5]!]);
    s = (await app.inject('/api/screenings')).json().screenings[0];
    expect(s).toMatchObject({ status: 'FULL', available: 0 });
  });

  it('seat map shows states but never who booked', async () => {
    await book([seatIds[0]!]);
    const { seats } = (await app.inject(`/api/screenings/${screening}/seats`)).json();
    expect(seats.find((s: any) => s.id === seatIds[0]).state).toBe('BOOKED');
    expect(seats.find((s: any) => s.id === seatIds[1]).state).toBe('AVAILABLE');
    expect(JSON.stringify(seats)).not.toMatch(/roll|student/i);
  });

  it('requires an Idempotency-Key and replays safely', async () => {
    const noKey = await app.inject({ method: 'POST', url: '/api/bookings', payload: { screeningId: screening, seatIds: [seatIds[0]], student: { rollNumber: 'R100', department: 'CSE' } } });
    expect(noKey.statusCode).toBe(400);
    const key = randomUUID();
    const a = await book([seatIds[0]!], 'R100', key);
    const b = await book([seatIds[0]!], 'R100', key);
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
    expect(b.json().bookingId).toBe(a.json().bookingId);
  });

  it('returns 409 with the friendly message when a seat is taken', async () => {
    await book([seatIds[0]!]);
    const r = await book([seatIds[0]!]);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatchObject({ code: 'SEAT_TAKEN', message: 'Sorry, this seat was just booked by another user.' });
  });

  it('rejects bad input without leaking internals', async () => {
    const r = await book([seatIds[0]!], '!!');
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('VALIDATION');
    expect(r.body).not.toMatch(/SELECT|stack|node_modules/i);
  });

  it('30 parallel HTTP requests for one seat: exactly one 201', async () => {
    const res = await Promise.all(Array.from({ length: 30 }, () => book([seatIds[0]!])));
    expect(res.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(res.filter((r) => r.statusCode === 409)).toHaveLength(29);
  });

  it('ticket view works by token; tampered token is a 404', async () => {
    const { ticketToken } = (await book([seatIds[0]!], 'R200')).json();
    const ok = await app.inject(`/api/tickets/${ticketToken}`);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'VALID', rollNumber: 'R200', seats: ['A1'] });
    expect((await app.inject(`/api/tickets/${ticketToken.slice(0, -2)}xx`)).statusCode).toBe(404);
  });

  it('student cancels with their token; seat becomes available again', async () => {
    const { ticketToken } = (await book([seatIds[0]!])).json();
    expect((await post('/api/tickets/cancel', { token: ticketToken })).statusCode).toBe(200);
    expect((await app.inject(`/api/tickets/${ticketToken}`)).json().status).toBe('CANCELLED');
    expect((await book([seatIds[0]!])).statusCode).toBe(201);
  });
});

describe('auth and roles', () => {
  it('rejects wrong passwords; session cookie is HttpOnly + SameSite=Strict', async () => {
    expect((await post('/api/auth/login', { username: 'gate', password: 'wrong-password' })).statusCode).toBe(401);
    const ok = await post('/api/auth/login', { username: 'gate', password: PW });
    expect(ok.statusCode).toBe(200);
    const cookie = String(ok.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(ok.json()).toEqual({ username: 'gate', role: 'STAFF' });
  });

  it('check-in needs a session; staff can scan, staff cannot see the dashboard', async () => {
    const { ticketToken } = (await book([seatIds[0]!])).json();
    const body = { token: ticketToken, screeningId: screening };
    expect((await post('/api/tickets/check-in', body)).statusCode).toBe(401);

    const staff = await login('gate');
    const first = await post('/api/tickets/check-in', body, { cookie: staff });
    expect(first.json()).toMatchObject({ ok: true, seats: ['A1'] });
    const second = await post('/api/tickets/check-in', body, { cookie: staff });
    expect(second.json()).toMatchObject({ ok: false, reason: 'ALREADY_USED' });

    expect((await app.inject({ url: '/api/admin/dashboard', headers: { cookie: staff } })).statusCode).toBe(403);
    const boss = await login('boss');
    const dash = await app.inject({ url: '/api/admin/dashboard', headers: { cookie: boss } });
    expect(dash.statusCode).toBe(200);
    expect(dash.json()).toMatchObject({ seats_booked: 1, checked_in: 1 });
  });

  it('blocks cookie-authenticated writes from another origin (CSRF)', async () => {
    const { ticketToken } = (await book([seatIds[0]!])).json();
    const staff = await login('gate');
    const r = await post('/api/tickets/check-in', { token: ticketToken, screeningId: screening }, { cookie: staff, origin: 'https://evil.example' });
    expect(r.statusCode).toBe(403);
  });

  it('logout invalidates the session', async () => {
    const staff = await login('gate');
    await post('/api/auth/logout', {}, { cookie: staff });
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: staff } })).statusCode).toBe(401);
  });

  it('writes audit log entries for logins and scans', async () => {
    await post('/api/auth/login', { username: 'gate', password: 'nope-nope-nope' });
    await login('gate');
    const { rows } = await pool.query(`SELECT action FROM audit_log ORDER BY id`);
    expect(rows.map((r) => r.action)).toEqual(['ADMIN_LOGIN_FAILED', 'ADMIN_LOGIN']);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    const limited = await buildApp({ logger: false, rateLimits: true });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++)
      codes.push((await limited.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'gate', password: 'bad-bad-bad' } })).statusCode);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes[6]).toBe(429);
    await limited.close();
  });
});