// Fills the REAL database with demo venues and screenings so the website has something to show.
// Usage: npm run seed:demo      (safe to run twice: it stops if the demo data already exists)
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.js';
import { createBooking } from '../src/services/booking.js';

const H = 3_600_000;
const at = (hours: number) => new Date(Date.now() + hours * H).toISOString();

if ((await pool.query(`SELECT 1 FROM venues WHERE name = 'Main Auditorium'`)).rowCount) {
  console.log('Demo data already exists. Nothing to do.');
  await pool.end();
  process.exit(0);
}

async function venue(name: string, description: string, rows: number, cols: number, aisleAfter: number, special: Record<string, string> = {}) {
  const { rows: [v] } = await pool.query(`INSERT INTO venues (name, description) VALUES ($1,$2) RETURNING id`, [name, description]);
  for (let r = 0; r < rows; r++)
    for (let c = 1; c <= cols; c++) {
      const row = String.fromCharCode(65 + r), label = `${row}${c}`;
      await pool.query(
        `INSERT INTO seats (venue_id, row_label, seat_label, grid_x, grid_y, kind) VALUES ($1,$2,$3,$4,$5,$6)`,
        [v.id, row, label, c - 1 + (c > aisleAfter ? 1 : 0), r, special[label] ?? 'STANDARD']);
    }
  return v.id as string;
}

async function screening(venueId: string, o: { film: string; desc: string; start: number; opens: number; closes: number; sizes: number[]; status?: string }) {
  const { rows: [s] } = await pool.query(
    `INSERT INTO screenings (film_name, description, venue_id, starts_at, ends_at, booking_opens_at, booking_closes_at,
       allowed_booking_sizes, cancellations_enabled, cancellation_deadline, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10) RETURNING id`,
    [o.film, o.desc, venueId, at(o.start), at(o.start + 3), at(o.opens), at(o.closes), o.sizes, at(o.start - 6), o.status ?? 'SCHEDULED']);
  return s.id as string;
}

const main = await venue('Main Auditorium', 'Our biggest hall: tiered seating with a centre aisle.', 8, 12, 6, { A1: 'RESERVED', A2: 'RESERVED', H12: 'DISABLED' });
const seminar = await venue('Seminar Hall', 'A cosy hall for smaller screenings.', 4, 8, 4);

const first = await screening(main, { film: 'Interstellar', desc: 'A space epic about time, family and survival. Doors open 30 minutes before the show.', start: 48, opens: -2, closes: 40, sizes: [1, 2, 4] });
await pool.query(
  `INSERT INTO form_fields (screening_id, field_key, label, field_type, required, validation, sort_order) VALUES
     ($1,'name','Full name','text',true,'{"maxLength":100}',0),
     ($1,'year','Year of study','select',true,'{"options":["1","2","3","4"]}',1),
     ($1,'phone','Phone number','phone',false,'{}',2)`, [first]);

const almost = await screening(seminar, { film: 'Parasite', desc: 'A sharp, funny and unsettling story about two families. Discussion after the film.', start: 72, opens: -5, closes: 60, sizes: [1, 2] });
await screening(main, { film: 'Spirited Away', desc: 'An animated adventure for a relaxed weekend evening. Booking opens tomorrow.', start: 120, opens: 24, closes: 100, sizes: [1, 2] });
await screening(main, { film: 'The Shawshank Redemption', desc: 'A past screening from our archive.', start: -120, opens: -240, closes: -130, sizes: [1, 2], status: 'COMPLETED' });

// Book 29 of the 32 seats in the Seminar Hall (using the real booking engine) so "Almost full" shows up.
const { rows: seats } = await pool.query(`SELECT id FROM seats WHERE venue_id = $1 ORDER BY grid_y, grid_x`, [seminar]);
let n = 1;
for (let i = 0; i < 29; i += 2) {
  const ids = seats.slice(i, Math.min(i + 2, 29)).map((s) => s.id);
  await createBooking({ screeningId: almost, seatIds: ids, idempotencyKey: randomUUID(),
    student: { rollNumber: `DEMO${String(n++).padStart(3, '0')}`, department: 'CSE' } });
}
console.log('Demo data created: 2 venues, 4 screenings (1 almost full, 1 not open yet, 1 past).');
await pool.end();
