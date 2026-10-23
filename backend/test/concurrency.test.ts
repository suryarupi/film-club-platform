import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

process.env.TICKET_HMAC_SECRET ??= 'test-secret-test-secret-test-secret-123';
const url = process.env.DATABASE_URL ?? '';
if (!/test/.test(url)) throw new Error('Refusing to run: DATABASE_URL must point at a database whose name contains "test" (schema is wiped).');

const { pool } = await import('../src/db.js');
const { createBooking, cancelBooking } = await import('../src/services/booking.js');
const { checkIn } = await import('../src/services/checkin.js');
const { tokenFor } = await import('../src/services/qr.js');
const { AppError } = await import('../src/errors.js');

const sql = readFileSync(new URL('../../database/migrations/001_init.sql', import.meta.url), 'utf8');
let staff: string, screening: string, venue: string, seatIds: string[];

async function seed(opts: { rows?: number; cols?: number; sizes?: number[]; opensOffset?: string } = {}) {
  const { rows = 2, cols = 3, sizes = [1, 2], opensOffset = '-1 hour' } = opts;
  await pool.query('TRUNCATE venues, students, admins, audit_log CASCADE');
  staff = (await pool.query(`INSERT INTO admins (username,password_hash,role) VALUES ('s','x','STAFF') RETURNING id`)).rows[0]!.id;
  venue = (await pool.query(`INSERT INTO venues (name) VALUES ('Test Hall') RETURNING id`)).rows[0]!.id;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    await pool.query(`INSERT INTO seats (venue_id,row_label,seat_label,grid_x,grid_y) VALUES ($1,$2,$3,$4,$5)`,
      [venue, String.fromCharCode(65 + r), `${String.fromCharCode(65 + r)}${c + 1}`, c, r]);
  screening = (await pool.query(
    `INSERT INTO screenings (film_name,venue_id,starts_at,ends_at,booking_opens_at,booking_closes_at,allowed_booking_sizes,status,cancellations_enabled)
     VALUES ('Interstellar',$1, now()+interval '2 days', now()+interval '2 days 3 hours',
             now() + $2::interval, now()+interval '1 day', $3, 'SCHEDULED', true) RETURNING id`, [venue, opensOffset, sizes])).rows[0]!.id;
  seatIds = (await pool.query(`SELECT id FROM seats WHERE venue_id=$1 ORDER BY seat_label`, [venue])).rows.map((r) => r.id);
}
const book = (seats: string[], roll = `R${Math.random()}`, key = randomUUID()) =>
  createBooking({ screeningId: screening, seatIds: seats, idempotencyKey: key, student: { rollNumber: roll, department: 'CSE' } });
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e) => (e instanceof AppError ? e.code : `UNEXPECTED:${e.message}`));
const activeSeatInvariant = async () => (await pool.query(
  `SELECT count(*)::int AS n FROM (SELECT seat_id FROM booking_seats WHERE screening_id=$1 AND active GROUP BY seat_id HAVING count(*)>1) x`, [screening])).rows[0].n;

beforeAll(async () => { await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await pool.query(sql); });
beforeEach(() => seed());
afterAll(() => pool.end());

describe('booking concurrency', () => {
  it('50 students race for one seat: exactly one wins', async () => {
    const res = await Promise.all(Array.from({ length: 50 }, () => code(book([seatIds[0]!]))));
    expect(res.filter((r) => r === 'OK')).toHaveLength(1);
    expect(res.filter((r) => r === 'SEAT_TAKEN')).toHaveLength(49);
    expect(await activeSeatInvariant()).toBe(0);
  });

  it('last seat: one winner, then screening reads as full', async () => {
    await seed({ rows: 1, cols: 1 });
    const res = await Promise.all(Array.from({ length: 30 }, () => code(book(seatIds))));
    expect(res.filter((r) => r === 'OK')).toHaveLength(1);
    expect(await code(book(seatIds))).toBe('SEAT_TAKEN');
  });

  it('overlapping pairs never overbook or deadlock', async () => {
    const pick = () => { const a = Math.floor(Math.random() * 6), b = (a + 1 + Math.floor(Math.random() * 5)) % 6; return [seatIds[a]!, seatIds[b]!]; };
    const res = await Promise.all(Array.from({ length: 80 }, () => code(book(pick()))));
    expect(res.filter((r) => r.startsWith('UNEXPECTED'))).toEqual([]);
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int n FROM booking_seats WHERE screening_id=$1 AND active`, [screening]);
    expect(n).toBeLessThanOrEqual(6);
    expect(await activeSeatInvariant()).toBe(0);
  });
});

describe('booking rules', () => {
  it('rejects disallowed party size', async () => expect(await code(book(seatIds.slice(0, 3)))).toBe('INVALID_PARTY_SIZE'));
  it('rejects disabled and reserved seats', async () => {
    await pool.query(`UPDATE seats SET kind='DISABLED' WHERE id=$1`, [seatIds[0]]);
    await pool.query(`UPDATE seats SET kind='RESERVED' WHERE id=$1`, [seatIds[1]]);
    expect(await code(book([seatIds[0]!]))).toBe('SEAT_NOT_BOOKABLE');
    expect(await code(book([seatIds[1]!]))).toBe('SEAT_NOT_BOOKABLE');
  });
  it('rejects booking before the window opens', async () => {
    await seed({ opensOffset: '+1 hour' });
    expect(await code(book([seatIds[0]!]))).toBe('BOOKING_CLOSED');
  });
  it('rejects booking on a cancelled screening', async () => {
    await pool.query(`UPDATE screenings SET status='CANCELLED' WHERE id=$1`, [screening]);
    expect(await code(book([seatIds[0]!]))).toBe('SCREENING_CANCELLED');
  });
});

describe('idempotency', () => {
  it('10 simultaneous retries with the same key create one booking', async () => {
    const key = randomUUID();
    const out = await Promise.all(Array.from({ length: 10 }, () => book([seatIds[0]!], 'ROLL1', key)));
    expect(new Set(out.map((o) => o.bookingId)).size).toBe(1);
    expect((await pool.query(`SELECT count(*)::int n FROM bookings`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int n FROM tickets`)).rows[0].n).toBe(1);
  });
});

describe('cancellation', () => {
  it('frees seats, kills the ticket, allows rebooking', async () => {
    const b = await book([seatIds[0]!], 'ROLL1');
    await cancelBooking(b.bookingId, { rollNumber: 'ROLL1' });
    expect((await checkIn(b.ticketToken, screening, staff))).toMatchObject({ ok: false, reason: 'CANCELLED' });
    await expect(book([seatIds[0]!])).resolves.toBeTruthy();
  });
  it("a student cannot cancel someone else's booking", async () => {
    const b = await book([seatIds[0]!], 'ROLL1');
    await expect(cancelBooking(b.bookingId, { rollNumber: 'ROLL2' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('cannot cancel after check-in', async () => {
    const b = await book([seatIds[0]!], 'ROLL1');
    await checkIn(b.ticketToken, screening, staff);
    await expect(cancelBooking(b.bookingId, { rollNumber: 'ROLL1' })).rejects.toMatchObject({ code: 'TICKET_USED' });
  });
});

describe('QR check-in', () => {
  it('20 validators scan the same ticket: exactly one check-in', async () => {
    const b = await book([seatIds[0]!]);
    const res = await Promise.all(Array.from({ length: 20 }, () => checkIn(b.ticketToken, screening, staff)));
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(res.filter((r) => !r.ok && r.reason === 'ALREADY_USED')).toHaveLength(19);
    expect((await pool.query(`SELECT count(*)::int n FROM check_ins`)).rows[0].n).toBe(1);
  });
  it('rejects forged, tampered and unknown tokens', async () => {
    const b = await book([seatIds[0]!]);
    expect(await checkIn(b.ticketToken.slice(0, -2) + 'xx', screening, staff)).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
    expect(await checkIn('garbage', screening, staff)).toMatchObject({ ok: false, reason: 'INVALID_SIGNATURE' });
    expect(await checkIn(tokenFor(randomUUID()), screening, staff)).toMatchObject({ ok: false, reason: 'NOT_FOUND' });
  });
  it('rejects a ticket for a different screening', async () => {
    const b = await book([seatIds[0]!]);
    expect(await checkIn(b.ticketToken, randomUUID(), staff)).toMatchObject({ ok: false, reason: 'WRONG_SCREENING' });
  });
});
