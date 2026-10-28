import { pool, withTx } from '../db.js';
import { AppError } from '../errors.js';

export type SeatKind = 'STANDARD' | 'DISABLED' | 'RESERVED' | 'VIP';
const notFound = () => new AppError('NOT_FOUND', 'Not found.', 404);
const venueExists = () => new AppError('VENUE_EXISTS', 'A venue with that name already exists.', 409);
const seatExists = () => new AppError('SEAT_EXISTS', 'A seat with that label or position already exists in this venue.', 409);

function rowLabel(i: number): string { // 0 -> A, 25 -> Z, 26 -> AA
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export async function listVenues() {
  const { rows } = await pool.query(`
    SELECT v.id, v.name, v.description, v.active,
           (SELECT count(*)::int FROM seats WHERE venue_id = v.id) AS seat_count,
           (SELECT count(*)::int FROM seats WHERE venue_id = v.id AND kind = 'STANDARD') AS capacity
      FROM venues v ORDER BY v.name`);
  return rows;
}

export async function createVenue(name: string, description: string) {
  try {
    const { rows: [v] } = await pool.query(
      `INSERT INTO venues (name, description) VALUES ($1,$2) RETURNING id, name, description, active`, [name, description]);
    return v;
  } catch (e: any) {
    if (e.code === '23505') throw venueExists();
    throw e;
  }
}

export async function updateVenue(id: string, p: { name?: string; description?: string; active?: boolean }) {
  return withTx(async (c) => {
    const { rows: [v] } = await c.query(`SELECT id FROM venues WHERE id = $1 FOR UPDATE`, [id]);
    if (!v) throw notFound();
    if (p.active === false) {
      const used = await c.query(`SELECT 1 FROM screenings WHERE venue_id = $1 AND status = 'SCHEDULED' AND ends_at > now() LIMIT 1`, [id]);
      if (used.rowCount) throw new AppError('VENUE_IN_USE', 'This venue has upcoming screenings. Cancel or move them first.', 409);
    }
    try {
      const { rows: [u] } = await c.query(
        `UPDATE venues SET name = COALESCE($2, name), description = COALESCE($3, description), active = COALESCE($4, active)
          WHERE id = $1 RETURNING id, name, description, active`,
        [id, p.name ?? null, p.description ?? null, p.active ?? null]);
      return u;
    } catch (e: any) {
      if (e.code === '23505') throw venueExists();
      throw e;
    }
  });
}

export async function getVenueSeats(id: string) {
  const { rows: [v] } = await pool.query(`SELECT id, name FROM venues WHERE id = $1`, [id]);
  if (!v) throw notFound();
  const { rows } = await pool.query(
    `SELECT id, seat_label AS label, row_label AS row, section, grid_x AS x, grid_y AS y, kind
       FROM seats WHERE venue_id = $1 ORDER BY grid_y, grid_x`, [id]);
  return { venue: v, seats: rows };
}

/** "Generate a 20 x 20 hall". aisleAfterColumns: [10] leaves a one-seat gap after column 10. */
export async function generateLayout(venueId: string, o: { rows: number; cols: number; aisleAfterColumns: number[]; replace: boolean }) {
  return withTx(async (c) => {
    const { rows: [v] } = await c.query(`SELECT id FROM venues WHERE id = $1 FOR UPDATE`, [venueId]);
    if (!v) throw notFound();
    const { rows: [ex] } = await c.query(`SELECT count(*)::int AS n FROM seats WHERE venue_id = $1`, [venueId]);
    if (ex.n > 0) {
      if (!o.replace) throw new AppError('LAYOUT_EXISTS', 'This venue already has seats. Choose "replace" to rebuild the layout.', 409);
      const used = await c.query(`SELECT 1 FROM booking_seats bs JOIN seats s ON s.id = bs.seat_id WHERE s.venue_id = $1 LIMIT 1`, [venueId]);
      if (used.rowCount) throw new AppError('LAYOUT_LOCKED', 'Seats in this venue already have bookings, so the layout cannot be rebuilt.', 409);
      await c.query(`DELETE FROM seats WHERE venue_id = $1`, [venueId]);
    }
    const rowsL: string[] = [], labels: string[] = [], xs: number[] = [], ys: number[] = [];
    for (let r = 0; r < o.rows; r++)
      for (let col = 1; col <= o.cols; col++) {
        rowsL.push(rowLabel(r));
        labels.push(`${rowLabel(r)}${col}`);
        xs.push(col - 1 + o.aisleAfterColumns.filter((a) => a < col).length);
        ys.push(r);
      }
    await c.query(
      `INSERT INTO seats (venue_id, row_label, seat_label, grid_x, grid_y)
       SELECT $1, t.r, t.l, t.x, t.y FROM unnest($2::text[], $3::text[], $4::int[], $5::int[]) AS t(r, l, x, y)`,
      [venueId, rowsL, labels, xs, ys]);
    return { seats: labels.length };
  });
}

export async function addSeat(venueId: string, s: { label: string; row: string; x: number; y: number; section: string; kind: SeatKind }) {
  try {
    const { rows: [r] } = await pool.query(
      `INSERT INTO seats (venue_id, seat_label, row_label, grid_x, grid_y, section, kind) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, seat_label AS label, row_label AS row, grid_x AS x, grid_y AS y, section, kind`,
      [venueId, s.label, s.row, s.x, s.y, s.section, s.kind]);
    return r;
  } catch (e: any) {
    if (e.code === '23505') throw seatExists();
    if (e.code === '23503') throw notFound();
    throw e;
  }
}

/** Bulk change: STANDARD / DISABLED / RESERVED / VIP. A currently-booked seat can't be taken out of service. */
export async function setSeatKind(venueId: string, seatIds: string[], kind: SeatKind) {
  return withTx(async (c) => {
    // Lock first: an in-flight booking holds a share lock on these rows, so we wait for it and then see its result.
    const { rows } = await c.query(`SELECT id FROM seats WHERE id = ANY($1::uuid[]) AND venue_id = $2 ORDER BY id FOR UPDATE`, [seatIds, venueId]);
    if (rows.length !== new Set(seatIds).size) throw new AppError('SEAT_NOT_FOUND', 'One or more seats do not exist in this venue.', 400);
    if (kind !== 'STANDARD') {
      const b = await c.query(`SELECT 1 FROM booking_seats WHERE seat_id = ANY($1::uuid[]) AND active LIMIT 1`, [seatIds]);
      if (b.rowCount) throw new AppError('SEAT_HAS_BOOKINGS', 'A selected seat is currently booked. Cancel that booking first.', 409);
    }
    await c.query(`UPDATE seats SET kind = $2 WHERE id = ANY($1::uuid[])`, [seatIds, kind]);
    return { updated: rows.length };
  });
}

export async function renameSeat(seatId: string, label: string) {
  try {
    const { rows: [r] } = await pool.query(`UPDATE seats SET seat_label = $2 WHERE id = $1 RETURNING id, seat_label AS label`, [seatId, label]);
    if (!r) throw notFound();
    return r;
  } catch (e: any) {
    if (e.code === '23505') throw seatExists();
    throw e;
  }
}

export async function deleteSeat(seatId: string) {
  return withTx(async (c) => {
    const { rows: [s] } = await c.query(`SELECT id FROM seats WHERE id = $1 FOR UPDATE`, [seatId]);
    if (!s) throw notFound();
    const h = await c.query(`SELECT 1 FROM booking_seats WHERE seat_id = $1 LIMIT 1`, [seatId]);
    if (h.rowCount) throw new AppError('SEAT_HAS_HISTORY', 'This seat has booking history. Disable it instead of deleting it.', 409);
    await c.query(`DELETE FROM seats WHERE id = $1`, [seatId]);
  });
}