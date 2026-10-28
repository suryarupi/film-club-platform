import type { PoolClient } from 'pg';
import { pool, withTx } from '../db.js';
import { AppError } from '../errors.js';

export interface ScreeningInput {
  filmName?: string; description?: string; posterUrl?: string | null; trailerUrl?: string | null; venueId?: string;
  startsAt?: string; endsAt?: string; bookingOpensAt?: string; bookingClosesAt?: string;
  allowedBookingSizes?: number[]; cancellationsEnabled?: boolean; cancellationDeadline?: string | null;
  status?: 'DRAFT' | 'SCHEDULED' | 'COMPLETED';
}
// Column names come from this fixed map only; values are always passed as query parameters.
const COLS: Record<keyof ScreeningInput, string> = {
  filmName: 'film_name', description: 'description', posterUrl: 'poster_url', trailerUrl: 'trailer_url', venueId: 'venue_id',
  startsAt: 'starts_at', endsAt: 'ends_at', bookingOpensAt: 'booking_opens_at', bookingClosesAt: 'booking_closes_at',
  allowedBookingSizes: 'allowed_booking_sizes', cancellationsEnabled: 'cancellations_enabled',
  cancellationDeadline: 'cancellation_deadline', status: 'status',
};
const notFound = () => new AppError('NOT_FOUND', 'Not found.', 404);
const badDates = (e: any) => e?.code === '23514'
  ? new AppError('INVALID_DATES', 'Please check the dates: the end must be after the start, and booking must close after it opens.', 400) : e;

async function assertVenueBookable(c: Pick<PoolClient, 'query'>, venueId: string) {
  const { rows: [v] } = await c.query(
    `SELECT active, (SELECT count(*)::int FROM seats WHERE venue_id = v.id AND kind = 'STANDARD') AS n FROM venues v WHERE id = $1`, [venueId]);
  if (!v) throw new AppError('VENUE_NOT_FOUND', 'That venue does not exist.', 400);
  if (!v.active) throw new AppError('VENUE_INACTIVE', 'That venue is deactivated.', 409);
  if (v.n === 0) throw new AppError('VENUE_HAS_NO_SEATS', 'Create a seat layout for this venue first.', 409);
}

export async function listAllScreenings() {
  const { rows } = await pool.query(`
    SELECT s.id, s.film_name AS "filmName", s.status, s.starts_at AS "startsAt", v.name AS venue,
           (SELECT count(*)::int FROM seats WHERE venue_id = s.venue_id AND kind = 'STANDARD') AS capacity,
           (SELECT count(*)::int FROM booking_seats WHERE screening_id = s.id AND active) AS booked
      FROM screenings s JOIN venues v ON v.id = s.venue_id ORDER BY s.starts_at DESC`);
  return rows;
}

export async function getScreeningAdmin(id: string) {
  const { rows: [s] } = await pool.query(`SELECT * FROM screenings WHERE id = $1`, [id]);
  if (!s) throw notFound();
  const { rows: formFields } = await pool.query(
    `SELECT field_key AS key, label, field_type AS type, required, validation FROM form_fields WHERE screening_id = $1 ORDER BY sort_order`, [id]);
  return { screening: s, formFields };
}

export async function createScreening(i: Required<Pick<ScreeningInput, 'filmName' | 'venueId' | 'startsAt' | 'endsAt' | 'bookingOpensAt' | 'bookingClosesAt'>> & ScreeningInput) {
  await assertVenueBookable(pool, i.venueId);
  try {
    const { rows: [r] } = await pool.query(
      `INSERT INTO screenings (film_name, description, poster_url, trailer_url, venue_id, starts_at, ends_at, booking_opens_at,
         booking_closes_at, allowed_booking_sizes, cancellations_enabled, cancellation_deadline, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [i.filmName, i.description ?? '', i.posterUrl ?? null, i.trailerUrl ?? null, i.venueId, i.startsAt, i.endsAt, i.bookingOpensAt,
       i.bookingClosesAt, i.allowedBookingSizes ?? [1, 2], i.cancellationsEnabled ?? false, i.cancellationDeadline ?? null, i.status ?? 'DRAFT']);
    return { id: r.id as string };
  } catch (e) { throw badDates(e); }
}

export async function updateScreening(id: string, p: ScreeningInput) {
  return withTx(async (c) => {
    // Lock the screening: in-flight bookings hold a share lock, so we wait for them and then see their result.
    const { rows: [s] } = await c.query(`SELECT status, venue_id FROM screenings WHERE id = $1 FOR UPDATE`, [id]);
    if (!s) throw notFound();
    if (s.status === 'CANCELLED' || s.status === 'COMPLETED')
      throw new AppError('SCREENING_LOCKED', 'A cancelled or completed screening cannot be edited.', 409);
    const venueChange = p.venueId !== undefined && p.venueId !== s.venue_id;
    if (venueChange || p.status === 'DRAFT') {
      const { rows: [b] } = await c.query(`SELECT count(*)::int AS n FROM bookings WHERE screening_id = $1 AND status = 'ACTIVE'`, [id]);
      if (b.n > 0) throw new AppError('HAS_BOOKINGS', 'This screening already has bookings, so its venue cannot change and it cannot go back to draft.', 409);
    }
    if (venueChange) await assertVenueBookable(c, p.venueId!);

    const sets: string[] = [];
    const vals: unknown[] = [id];
    for (const k of Object.keys(COLS) as (keyof ScreeningInput)[]) {
      if (p[k] !== undefined) { vals.push(p[k]); sets.push(`${COLS[k]} = $${vals.length}`); }
    }
    if (sets.length === 0) throw new AppError('NOTHING_TO_UPDATE', 'No changes were provided.', 400);
    try {
      await c.query(`UPDATE screenings SET ${sets.join(', ')} WHERE id = $1`, vals);
    } catch (e) { throw badDates(e); }
    return { id };
  });
}

/** Cancels the show, every active booking, every unused ticket and releases every seat: all or nothing. */
export async function cancelScreening(id: string) {
  return withTx(async (c) => {
    const { rows: [s] } = await c.query(`SELECT status FROM screenings WHERE id = $1 FOR UPDATE`, [id]);
    if (!s) throw notFound();
    if (s.status === 'CANCELLED') throw new AppError('ALREADY_CANCELLED', 'This screening is already cancelled.', 409);
    await c.query(`UPDATE screenings SET status = 'CANCELLED' WHERE id = $1`, [id]);
    await c.query(
      `UPDATE tickets SET status = 'CANCELLED' WHERE status = 'VALID'
         AND booking_id IN (SELECT id FROM bookings WHERE screening_id = $1 AND status = 'ACTIVE')`, [id]);
    await c.query(`UPDATE booking_seats SET active = false WHERE screening_id = $1 AND active`, [id]);
    const r = await c.query(`UPDATE bookings SET status = 'CANCELLED', cancelled_at = now() WHERE screening_id = $1 AND status = 'ACTIVE'`, [id]);
    return { cancelledBookings: r.rowCount ?? 0 };
  });
}

export interface FormFieldInput {
  key: string; label: string; type: 'text' | 'email' | 'phone' | 'number' | 'select'; required: boolean; validation: Record<string, unknown>;
}
/** Replaces the whole set of extra student-form fields for a screening. */
export async function setFormFields(screeningId: string, fields: FormFieldInput[]) {
  return withTx(async (c) => {
    const { rows: [s] } = await c.query(`SELECT id FROM screenings WHERE id = $1 FOR UPDATE`, [screeningId]);
    if (!s) throw notFound();
    await c.query(`DELETE FROM form_fields WHERE screening_id = $1`, [screeningId]);
    for (const [i, f] of fields.entries())
      await c.query(
        `INSERT INTO form_fields (screening_id, field_key, label, field_type, required, validation, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [screeningId, f.key, f.label, f.type, f.required, JSON.stringify(f.validation), i]);
    return { fields: fields.length };
  });
}