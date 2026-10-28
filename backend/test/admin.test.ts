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
type M = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
let app: Awaited<ReturnType<typeof buildApp>>;
let boss = '', gate = '';

async function login(username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: PW }, headers: { origin: ORIGIN } });
  return `${r.cookies[0]!.name}=${r.cookies[0]!.value}`;
}
const call = (method: M, url: string, payload?: object, cookie = boss) =>
  app.inject({ method, url, payload, headers: { origin: ORIGIN, cookie } });
const iso = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function makeVenue(rows = 2, cols = 3, name = 'Hall') {
  const v = (await call('POST', '/api/admin/venues', { name })).json();
  await call('POST', `/api/admin/venues/${v.id}/layout`, { rows, cols });
  return v.id as string;
}
const makeScreening = (venueId: string, extra: object = {}) =>
  call('POST', '/api/admin/screenings', {
    filmName: 'Interstellar', venueId, startsAt: iso(48), endsAt: iso(51), bookingOpensAt: iso(-1), bookingClosesAt: iso(24),
    status: 'SCHEDULED', allowedBookingSizes: [1, 2], cancellationsEnabled: true, ...extra,
  });
const seatsOf = async (venueId: string) =>
  (await call('GET', `/api/admin/venues/${venueId}/seats`)).json().seats as { id: string; label: string; x: number; y: number; kind: string }[];
const book = (screeningId: string, seatIds: string[], roll = `R${Math.random().toString(36).slice(2, 8)}`) =>
  app.inject({ method: 'POST', url: '/api/bookings', headers: { 'idempotency-key': randomUUID() },
    payload: { screeningId, seatIds, student: { rollNumber: roll, department: 'CSE' } } });

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  for (const m of migrations) await pool.query(m);
  app = await buildApp({ logger: false, rateLimits: false });
});
beforeEach(async () => {
  await pool.query('TRUNCATE venues, students, admins, audit_log CASCADE');
  const hash = await hashPassword(PW);
  await pool.query(`INSERT INTO admins (username,password_hash,role) VALUES ('boss',$1,'SUPER_ADMIN'),('gate',$1,'STAFF')`, [hash]);
  boss = await login('boss');
  gate = await login('gate');
});
afterAll(async () => { await app.close(); await pool.end(); });

describe('access control', () => {
  it('rejects requests with no session', async () => {
    expect((await app.inject('/api/admin/venues')).statusCode).toBe(401);
  });
  it('rejects screening staff', async () => {
    expect((await call('GET', '/api/admin/venues', undefined, gate)).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/venues', { name: 'X' }, gate)).statusCode).toBe(403);
  });
  it('blocks writes from another origin (CSRF)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/venues', payload: { name: 'X' }, headers: { origin: 'https://evil.example', cookie: boss } });
    expect(r.statusCode).toBe(403);
  });
});

describe('venues and layouts', () => {
  it('creates a venue and rejects a duplicate name', async () => {
    const a = await call('POST', '/api/admin/venues', { name: 'Auditorium', description: 'Main hall' });
    expect(a.statusCode).toBe(201);
    const b = await call('POST', '/api/admin/venues', { name: 'Auditorium' });
    expect(b.statusCode).toBe(409);
    expect(b.json().error.code).toBe('VENUE_EXISTS');
  });

  it('generates a 20 x 20 hall in one call', async () => {
    const v = (await call('POST', '/api/admin/venues', { name: 'Big Hall' })).json();
    const r = await call('POST', `/api/admin/venues/${v.id}/layout`, { rows: 20, cols: 20 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ seats: 400 });
    const seats = await seatsOf(v.id);
    expect(seats).toHaveLength(400);
    expect(seats.some((s) => s.label === 'A1')).toBe(true);
    expect(seats.some((s) => s.label === 'T20')).toBe(true);
    const list = (await call('GET', '/api/admin/venues')).json().venues;
    expect(list[0]).toMatchObject({ seat_count: 400, capacity: 400 });
  });

  it('leaves a gap for an aisle', async () => {
    const v = (await call('POST', '/api/admin/venues', { name: 'Aisle Hall' })).json();
    await call('POST', `/api/admin/venues/${v.id}/layout`, { rows: 1, cols: 4, aisleAfterColumns: [2] });
    expect((await seatsOf(v.id)).map((s) => s.x)).toEqual([0, 1, 3, 4]);
  });

  it('only rebuilds a layout when asked, and never once seats have bookings', async () => {
    const venue = await makeVenue(1, 2);
    const again = await call('POST', `/api/admin/venues/${venue}/layout`, { rows: 2, cols: 2 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('LAYOUT_EXISTS');
    const ok = await call('POST', `/api/admin/venues/${venue}/layout`, { rows: 2, cols: 2, replace: true });
    expect(ok.json()).toEqual({ seats: 4 });

    const sc = (await makeScreening(venue)).json().id;
    const seats = await seatsOf(venue);
    expect((await book(sc, [seats[0]!.id])).statusCode).toBe(201);
    const locked = await call('POST', `/api/admin/venues/${venue}/layout`, { rows: 1, cols: 1, replace: true });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('LAYOUT_LOCKED');
  });

  it('disabling seats lowers capacity; a booked seat cannot be disabled', async () => {
    const venue = await makeVenue(2, 3);
    const sc = (await makeScreening(venue)).json().id;
    const seats = await seatsOf(venue);
    const dis = await call('PATCH', `/api/admin/venues/${venue}/seats/kind`, { seatIds: [seats[0]!.id, seats[1]!.id], kind: 'DISABLED' });
    expect(dis.json()).toEqual({ updated: 2 });
    const v = (await call('GET', '/api/admin/venues')).json().venues.find((x: any) => x.id === venue);
    expect(v).toMatchObject({ seat_count: 6, capacity: 4 });

    expect((await book(sc, [seats[2]!.id])).statusCode).toBe(201);
    const blocked = await call('PATCH', `/api/admin/venues/${venue}/seats/kind`, { seatIds: [seats[2]!.id], kind: 'DISABLED' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('SEAT_HAS_BOOKINGS');
  });

  it('reserved seats cannot be booked by students', async () => {
    const venue = await makeVenue(1, 3);
    const sc = (await makeScreening(venue)).json().id;
    const seats = await seatsOf(venue);
    await call('PATCH', `/api/admin/venues/${venue}/seats/kind`, { seatIds: [seats[0]!.id], kind: 'RESERVED' });
    const r = await book(sc, [seats[0]!.id]);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('SEAT_NOT_BOOKABLE');
  });
});

describe('screenings', () => {
  it('refuses a venue that has no seats yet', async () => {
    const v = (await call('POST', '/api/admin/venues', { name: 'Empty' })).json();
    const r = await makeScreening(v.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('VENUE_HAS_NO_SEATS');
  });

  it('keeps drafts hidden and shows scheduled screenings as OPEN', async () => {
    const venue = await makeVenue();
    const sc = (await makeScreening(venue, { status: 'DRAFT' })).json().id;
    expect((await app.inject('/api/screenings')).json().screenings).toHaveLength(0);
    expect((await call('PUT', `/api/admin/screenings/${sc}`, { status: 'SCHEDULED' })).statusCode).toBe(200);
    const list = (await app.inject('/api/screenings')).json().screenings;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filmName: 'Interstellar', status: 'OPEN', capacity: 6 });
  });

  it('rejects an end time before the start time', async () => {
    const venue = await makeVenue();
    const r = await makeScreening(venue, { startsAt: iso(48), endsAt: iso(47) });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('INVALID_DATES');
  });

  it('allows edits, but not changing the venue once bookings exist', async () => {
    const a = await makeVenue(1, 3, 'A');
    const b = await makeVenue(1, 3, 'B');
    const sc = (await makeScreening(a)).json().id;
    const seats = await seatsOf(a);
    await book(sc, [seats[0]!.id]);
    const move = await call('PUT', `/api/admin/screenings/${sc}`, { venueId: b });
    expect(move.statusCode).toBe(409);
    expect(move.json().error.code).toBe('HAS_BOOKINGS');
    expect((await call('PUT', `/api/admin/screenings/${sc}`, { filmName: 'Dune' })).statusCode).toBe(200);
    expect((await call('GET', `/api/admin/screenings/${sc}`)).json().screening.film_name).toBe('Dune');
  });

  it('cancelling a screening cancels bookings and tickets and frees every seat', async () => {
    const venue = await makeVenue(1, 4);
    const sc = (await makeScreening(venue)).json().id;
    const seats = await seatsOf(venue);
    await book(sc, [seats[0]!.id]);
    await book(sc, [seats[1]!.id, seats[2]!.id]);

    const c1 = await call('POST', `/api/admin/screenings/${sc}/cancel`);
    expect(c1.json()).toEqual({ cancelledBookings: 2 });
    expect((await pool.query(`SELECT count(*)::int n FROM booking_seats WHERE active`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT DISTINCT status FROM tickets`)).rows).toEqual([{ status: 'CANCELLED' }]);

    const rebook = await book(sc, [seats[0]!.id]);
    expect(rebook.statusCode).toBe(409);
    expect(rebook.json().error.code).toBe('SCREENING_CANCELLED');
    expect((await call('POST', `/api/admin/screenings/${sc}/cancel`)).statusCode).toBe(409);
    const edit = await call('PUT', `/api/admin/screenings/${sc}`, { filmName: 'X' });
    expect(edit.json().error.code).toBe('SCREENING_LOCKED');
  });

  it('saves student form fields and rejects bad ones', async () => {
    const venue = await makeVenue();
    const sc = (await makeScreening(venue)).json().id;
    const fields = [
      { key: 'phone', label: 'Phone', type: 'phone', required: false, validation: { pattern: '^[0-9]{10}$' } },
      { key: 'year', label: 'Year', type: 'select', required: true, validation: { options: ['1', '2', '3', '4'] } },
    ];
    const ok = await call('PUT', `/api/admin/screenings/${sc}/form-fields`, { fields });
    expect(ok.json()).toEqual({ fields: 2 });
    const pub = (await app.inject(`/api/screenings/${sc}`)).json();
    expect(pub.formFields.map((f: any) => f.key)).toEqual(['phone', 'year']);

    const badRegex = await call('PUT', `/api/admin/screenings/${sc}/form-fields`, { fields: [{ ...fields[0], validation: { pattern: '[' } }] });
    expect(badRegex.statusCode).toBe(400);
    const dup = await call('PUT', `/api/admin/screenings/${sc}/form-fields`, { fields: [fields[0], fields[0]] });
    expect(dup.statusCode).toBe(400);
  });
});

describe('races and auditing', () => {
  it('disabling a seat while students race to book it never leaves a booked, disabled seat', async () => {
    const venue = await makeVenue(1, 1, 'Race');
    const sc = (await makeScreening(venue)).json().id;
    const [seat] = await seatsOf(venue);
    const results = await Promise.all([
      call('PATCH', `/api/admin/venues/${venue}/seats/kind`, { seatIds: [seat!.id], kind: 'DISABLED' }),
      ...Array.from({ length: 20 }, () => book(sc, [seat!.id])),
    ]);
    const disable = results[0]!;
    const booked = results.slice(1).filter((r) => r.statusCode === 201).length;
    const active = (await pool.query(`SELECT count(*)::int n FROM booking_seats WHERE seat_id = $1 AND active`, [seat!.id])).rows[0].n;
    const kind = (await pool.query(`SELECT kind FROM seats WHERE id = $1`, [seat!.id])).rows[0].kind;
    if (disable.statusCode === 200) {
      expect([kind, active, booked]).toEqual(['DISABLED', 0, 0]);
    } else {
      expect(disable.statusCode).toBe(409);
      expect([kind, active, booked]).toEqual(['STANDARD', 1, 1]);
    }
  });

  it('records admin actions in the audit log', async () => {
    await makeVenue(1, 2);
    const actions = (await pool.query(`SELECT action FROM audit_log ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toContain('VENUE_CREATED');
    expect(actions).toContain('LAYOUT_GENERATED');
  });
});