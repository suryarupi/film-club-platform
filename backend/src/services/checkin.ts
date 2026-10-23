import { pool, withTx } from '../db.js';
import { verifyToken } from './qr.js';

export type ScanResult =
  | { ok: true; ticketId: string; student: { rollNumber: string; name: string | null }; film: string; seats: string[]; checkedInAt: Date }
  | { ok: false; reason: 'INVALID_SIGNATURE' | 'NOT_FOUND' | 'WRONG_SCREENING' | 'CANCELLED' | 'SCREENING_CANCELLED' | 'ALREADY_USED'; firstScannedAt?: Date };

const DETAILS = `
  SELECT t.id, t.status, t.checked_in_at, b.screening_id, s.status AS screening_status, s.film_name,
         st.roll_number, st.name,
         (SELECT array_agg(se.seat_label ORDER BY se.seat_label) FROM booking_seats bs JOIN seats se ON se.id = bs.seat_id WHERE bs.booking_id = b.id) AS seats
    FROM tickets t JOIN bookings b ON b.id = t.booking_id JOIN screenings s ON s.id = b.screening_id JOIN students st ON st.id = b.student_id`;

async function diagnose(ticketId: string, screeningId: string): Promise<ScanResult> {
  const { rows: [t] } = await pool.query(`${DETAILS} WHERE t.id = $1`, [ticketId]);
  if (!t) return { ok: false, reason: 'NOT_FOUND' };
  if (t.screening_id !== screeningId) return { ok: false, reason: 'WRONG_SCREENING' };
  if (t.screening_status === 'CANCELLED') return { ok: false, reason: 'SCREENING_CANCELLED' };
  if (t.status === 'CANCELLED') return { ok: false, reason: 'CANCELLED' };
  if (t.status === 'USED') return { ok: false, reason: 'ALREADY_USED', firstScannedAt: t.checked_in_at };
  return { ok: false, reason: 'NOT_FOUND' };
}

/** Read-only preview shown on the validator before "Mark Entry". Never changes state. */
export async function peekTicket(token: string, screeningId: string): Promise<ScanResult> {
  const id = verifyToken(token);
  if (!id) return { ok: false, reason: 'INVALID_SIGNATURE' };
  const { rows: [t] } = await pool.query(`${DETAILS} WHERE t.id = $1 AND t.status = 'VALID'
     AND b.screening_id = $2 AND s.status <> 'CANCELLED'`, [id, screeningId]);
  if (!t) return diagnose(id, screeningId);
  return { ok: true, ticketId: t.id, student: { rollNumber: t.roll_number, name: t.name }, film: t.film_name, seats: t.seats, checkedInAt: new Date() };
}

/** Atomic check-in. The single conditional UPDATE is the lock: of N simultaneous scans, exactly one
 *  matches `status = 'VALID'`; the rest see 0 rows and get ALREADY_USED. */
export async function checkIn(token: string, screeningId: string, staffId: string): Promise<ScanResult> {
  const id = verifyToken(token);
  if (!id) return { ok: false, reason: 'INVALID_SIGNATURE' };
  const won = await withTx(async (c) => {
    const u = await c.query(
      `UPDATE tickets t SET status='USED', checked_in_at=now(), checked_in_by=$3
         FROM bookings b JOIN screenings s ON s.id = b.screening_id
        WHERE t.id=$1 AND t.status='VALID' AND b.id=t.booking_id AND b.screening_id=$2 AND s.status <> 'CANCELLED'
        RETURNING t.checked_in_at`, [id, screeningId, staffId]);
    if (u.rowCount !== 1) return null;
    await c.query(`INSERT INTO check_ins (ticket_id, scanned_by) VALUES ($1,$2)`, [id, staffId]);
    return u.rows[0].checked_in_at as Date;
  });
  if (!won) return diagnose(id, screeningId);
  const { rows: [t] } = await pool.query(`${DETAILS} WHERE t.id = $1`, [id]);
  return { ok: true, ticketId: id, student: { rollNumber: t.roll_number, name: t.name }, film: t.film_name, seats: t.seats, checkedInAt: won };
}
