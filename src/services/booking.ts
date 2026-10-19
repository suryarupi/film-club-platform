import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, withTx } from '../db.js';
import { AppError } from '../errors.js';
import { tokenFor } from './qr.js';

export interface BookingInput {
  screeningId: string;
  seatIds: string[];
  idempotencyKey: string; // client-generated UUID, reused on retries / double-clicks
  student: { rollNumber: string; department: string; name?: string; email?: string };
  formData?: Record<string, unknown>;
}
export interface BookingResult { bookingId: string; reference: string; seats: string[]; ticketToken: string; replayed: boolean }

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function newReference(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  let s = '';
  for (const b of randomBytes(6)) s += ALPHABET[b % ALPHABET.length];
  return `SCR-${day}-${s}`;
}

type Q = Pick<PoolClient, 'query'>;
async function findByKey(q: Q, key: string, roll: string): Promise<BookingResult | null> {
  const { rows } = await q.query(
    `SELECT b.id, b.reference, st.roll_number, t.id AS ticket_id,
            array_agg(se.seat_label ORDER BY se.seat_label) AS seats
       FROM bookings b
       JOIN students st ON st.id = b.student_id
       JOIN tickets t ON t.booking_id = b.id
       JOIN booking_seats bs ON bs.booking_id = b.id
       JOIN seats se ON se.id = bs.seat_id
      WHERE b.idempotency_key = $1
      GROUP BY b.id, st.roll_number, t.id`, [key]);
  const r = rows[0];
  if (!r) return null;
  if (r.roll_number !== roll) throw new AppError('IDEMPOTENCY_KEY_REUSED', 'Invalid request. Please refresh and try again.', 409);
  return { bookingId: r.id, reference: r.reference, seats: r.seats, ticketToken: tokenFor(r.ticket_id), replayed: true };
}

export async function createBooking(input: BookingInput): Promise<BookingResult> {
  const seatIds = [...new Set(input.seatIds)];
  if (seatIds.length !== input.seatIds.length || seatIds.length === 0)
    throw new AppError('INVALID_SEATS', 'Please select valid, distinct seats.', 400);
  try {
    return await withTx((c) => run(c, { ...input, seatIds }));
  } catch (e: any) {
    if (e?.code === '23505') {
      // Concurrent duplicate request: the loser waits for the winner to commit, then lands here.
      if (e.constraint === 'bookings_idempotency_key_key') {
        const prior = await findByKey(pool, input.idempotencyKey, input.student.rollNumber);
        if (prior) return prior;
      }
      // Someone else committed the same seat first. The DB constraint is the final arbiter.
      if (e.constraint === 'booking_seats_active_seat_uq')
        throw new AppError('SEAT_TAKEN', 'Sorry, this seat was just booked by another user.', 409);
    }
    throw e;
  }
}

async function run(c: PoolClient, i: BookingInput & { seatIds: string[] }): Promise<BookingResult> {
  const replay = await findByKey(c, i.idempotencyKey, i.student.rollNumber);
  if (replay) return replay;

  // FOR SHARE: admins editing/cancelling the screening (UPDATE) serialise against in-flight bookings.
  const { rows: [s] } = await c.query(
    `SELECT venue_id, status, allowed_booking_sizes,
            (now() >= booking_opens_at AND now() < booking_closes_at) AS is_open
       FROM screenings WHERE id = $1 FOR SHARE`, [i.screeningId]);
  if (!s || s.status === 'DRAFT') throw new AppError('NOT_FOUND', 'Screening not found.', 404);
  if (s.status === 'CANCELLED') throw new AppError('SCREENING_CANCELLED', 'This screening has been cancelled.', 409);
  if (s.status !== 'SCHEDULED' || !s.is_open) throw new AppError('BOOKING_CLOSED', 'Booking is currently closed.', 409);
  if (!s.allowed_booking_sizes.includes(i.seatIds.length))
    throw new AppError('INVALID_PARTY_SIZE', 'That number of seats is not allowed for this screening.', 400);

  // Lock seat rows in a fixed order (no deadlocks) so an admin disabling a seat can't race a booking.
  const { rows: seats } = await c.query(
    `SELECT id, seat_label, kind FROM seats
      WHERE id = ANY($1::uuid[]) AND venue_id = $2 ORDER BY id FOR SHARE`, [i.seatIds, s.venue_id]);
  if (seats.length !== i.seatIds.length) throw new AppError('SEAT_NOT_FOUND', 'One or more seats do not exist.', 400);
  if (seats.some((x) => x.kind !== 'STANDARD')) throw new AppError('SEAT_NOT_BOOKABLE', 'One or more seats cannot be booked.', 409);

  const { rows: [st] } = await c.query(
    `INSERT INTO students (roll_number, department, name, email) VALUES ($1,$2,$3,$4)
     ON CONFLICT (roll_number) DO UPDATE
       SET department = EXCLUDED.department,
           name  = COALESCE(EXCLUDED.name,  students.name),
           email = COALESCE(EXCLUDED.email, students.email)
     RETURNING id`,
    [i.student.rollNumber, i.student.department, i.student.name ?? null, i.student.email ?? null]);

  const { rows: [b] } = await c.query(
    `INSERT INTO bookings (screening_id, student_id, reference, idempotency_key, seat_count, form_data)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, reference`,
    [i.screeningId, st.id, newReference(), i.idempotencyKey, i.seatIds.length, JSON.stringify(i.formData ?? {})]);

  // If any seat is already actively booked, this INSERT raises 23505 and the whole tx rolls back.
  await c.query(
    `INSERT INTO booking_seats (booking_id, screening_id, seat_id)
     SELECT $1, $2, unnest($3::uuid[])`, [b.id, i.screeningId, i.seatIds]);

  const ticketId = randomUUID();
  await c.query(`INSERT INTO tickets (id, booking_id) VALUES ($1,$2)`, [ticketId, b.id]);

  return { bookingId: b.id, reference: b.reference, seats: seats.map((x) => x.seat_label).sort(), ticketToken: tokenFor(ticketId), replayed: false };
}

/** Atomic cancellation: ticket invalidated, seats released, booking marked — all or nothing. */
export async function cancelBooking(bookingId: string, opts: { rollNumber?: string; byAdmin?: boolean } = {}): Promise<void> {
  await withTx(async (c) => {
    const { rows: [b] } = await c.query(
      `SELECT b.id, b.status, st.roll_number, s.cancellations_enabled,
              (s.cancellation_deadline IS NULL OR now() < s.cancellation_deadline) AS before_deadline
         FROM bookings b JOIN students st ON st.id = b.student_id JOIN screenings s ON s.id = b.screening_id
        WHERE b.id = $1 FOR UPDATE OF b`, [bookingId]);
    if (!b || (!opts.byAdmin && b.roll_number !== opts.rollNumber)) throw new AppError('NOT_FOUND', 'Booking not found.', 404);
    if (b.status !== 'ACTIVE') throw new AppError('ALREADY_CANCELLED', 'This booking is already cancelled.', 409);
    if (!opts.byAdmin && (!b.cancellations_enabled || !b.before_deadline))
      throw new AppError('CANCELLATION_CLOSED', 'Cancellation is no longer available for this booking.', 403);

    // Conditional update races correctly with check-in: only a still-VALID ticket can be cancelled.
    const t = await c.query(`UPDATE tickets SET status='CANCELLED' WHERE booking_id=$1 AND status='VALID'`, [bookingId]);
    if (t.rowCount !== 1) throw new AppError('TICKET_USED', 'This ticket has already been used.', 409);
    await c.query(`UPDATE booking_seats SET active=false WHERE booking_id=$1`, [bookingId]);
    await c.query(`UPDATE bookings SET status='CANCELLED', cancelled_at=now() WHERE id=$1`, [bookingId]);
  });
}
