import { pool } from '../db.js';
import { AppError } from '../errors.js';
import { cancelBooking } from './booking.js';
import { verifyToken } from './qr.js';

const invalid = () => new AppError('INVALID_TICKET', 'Invalid ticket.', 404);

export async function getTicketView(token: string) {
  const id = verifyToken(token);
  if (!id) throw invalid();
  const { rows: [t] } = await pool.query(
    `SELECT t.status, t.checked_in_at, b.reference, s.film_name, s.starts_at, s.ends_at, v.name AS venue_name, st.roll_number,
            (SELECT array_agg(se.seat_label ORDER BY se.seat_label) FROM booking_seats bs JOIN seats se ON se.id = bs.seat_id WHERE bs.booking_id = b.id) AS seats
       FROM tickets t JOIN bookings b ON b.id = t.booking_id JOIN screenings s ON s.id = b.screening_id
       JOIN venues v ON v.id = s.venue_id JOIN students st ON st.id = b.student_id
      WHERE t.id = $1`, [id]);
  if (!t) throw invalid();
  return { token, status: t.status, reference: t.reference, filmName: t.film_name, startsAt: t.starts_at, endsAt: t.ends_at,
           venue: t.venue_name, rollNumber: t.roll_number, seats: t.seats, checkedInAt: t.checked_in_at };
}

/** Holding the unguessable token proves ownership, so students need no account to cancel. */
export async function cancelByToken(token: string) {
  const id = verifyToken(token);
  if (!id) throw invalid();
  const { rows: [b] } = await pool.query(
    `SELECT b.id, st.roll_number FROM tickets t JOIN bookings b ON b.id = t.booking_id JOIN students st ON st.id = b.student_id WHERE t.id = $1`, [id]);
  if (!b) throw invalid();
  await cancelBooking(b.id, { rollNumber: b.roll_number });
}