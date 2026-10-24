import { pool } from '../db.js';

export type PublicStatus = 'NOT_OPEN' | 'OPEN' | 'ALMOST_FULL' | 'FULL' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';

/** Status is computed from the database clock and live seat counts — never stored, never taken from the client. */
export function deriveStatus(r: { status: string; ends_at: Date; booking_opens_at: Date; booking_closes_at: Date; capacity: number; booked: number }, now: Date): PublicStatus {
  if (r.status === 'CANCELLED') return 'CANCELLED';
  if (r.status === 'COMPLETED' || r.ends_at <= now) return 'COMPLETED';
  if (now < r.booking_opens_at) return 'NOT_OPEN';
  if (now >= r.booking_closes_at) return 'CLOSED';
  const available = r.capacity - r.booked;
  if (available <= 0) return 'FULL';
  if (available <= Math.max(1, Math.ceil(r.capacity * 0.1))) return 'ALMOST_FULL';
  return 'OPEN';
}

const BASE = `
  SELECT s.id, s.film_name, s.description, s.poster_url, s.trailer_url, s.starts_at, s.ends_at,
         s.booking_opens_at, s.booking_closes_at, s.allowed_booking_sizes, s.status,
         v.name AS venue_name, v.description AS venue_description,
         cap.n AS capacity, bk.n AS booked, now() AS db_now
    FROM screenings s
    JOIN venues v ON v.id = s.venue_id
   CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM seats WHERE venue_id = s.venue_id AND kind = 'STANDARD') cap
   CROSS JOIN LATERAL (SELECT count(*)::int AS n FROM booking_seats WHERE screening_id = s.id AND active) bk`;

function shape(r: any) {
  return {
    id: r.id, filmName: r.film_name, description: r.description, posterUrl: r.poster_url, trailerUrl: r.trailer_url,
    venue: { name: r.venue_name, description: r.venue_description },
    startsAt: r.starts_at, endsAt: r.ends_at, bookingOpensAt: r.booking_opens_at, bookingClosesAt: r.booking_closes_at,
    allowedBookingSizes: r.allowed_booking_sizes, capacity: r.capacity, booked: r.booked,
    available: Math.max(0, r.capacity - r.booked), status: deriveStatus(r, r.db_now),
  };
}

export async function listScreenings() {
  const { rows } = await pool.query(`${BASE} WHERE s.status <> 'DRAFT' AND s.ends_at > now() - interval '60 days' ORDER BY s.starts_at`);
  return rows.map(shape);
}

export async function getScreening(id: string) {
  const { rows: [r] } = await pool.query(`${BASE} WHERE s.id = $1 AND s.status <> 'DRAFT'`, [id]);
  if (!r) return null;
  const { rows: fields } = await pool.query(
    `SELECT field_key AS key, label, field_type AS type, required, validation FROM form_fields WHERE screening_id=$1 ORDER BY sort_order`, [id]);
  return { ...shape(r), formFields: fields };
}

export async function getSeatMap(screeningId: string) {
  const { rows } = await pool.query(
    `SELECT se.id, se.seat_label, se.row_label, se.section, se.grid_x, se.grid_y, se.kind, (bs.seat_id IS NOT NULL) AS booked
       FROM screenings s
       JOIN seats se ON se.venue_id = s.venue_id
       LEFT JOIN booking_seats bs ON bs.screening_id = s.id AND bs.seat_id = se.id AND bs.active
      WHERE s.id = $1 AND s.status <> 'DRAFT'
      ORDER BY se.grid_y, se.grid_x`, [screeningId]);
  // Never expose who booked a seat — only its state.
  return rows.map((r) => ({
    id: r.id, label: r.seat_label, row: r.row_label, section: r.section, x: r.grid_x, y: r.grid_y,
    state: r.kind !== 'STANDARD' ? r.kind : r.booked ? 'BOOKED' : 'AVAILABLE',
  }));
}