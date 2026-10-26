import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/context.js';
import { pool } from '../db.js';
import { audit } from '../services/audit.js';
import { checkIn, peekTicket } from '../services/checkin.js';

const ScanBody = z.object({ token: z.string().min(1).max(200), screeningId: z.string().uuid() });
const staffOrAdmin = requireRole('STAFF', 'SUPER_ADMIN');

export const staffRoutes: FastifyPluginAsync = async (app) => {
  // Read-only preview shown before "Mark Entry".
  app.post('/api/tickets/validate', { preHandler: staffOrAdmin }, async (req) => {
    const b = ScanBody.parse(req.body);
    return peekTicket(b.token, b.screeningId);
  });

  app.post('/api/tickets/check-in', { preHandler: staffOrAdmin }, async (req) => {
    const b = ScanBody.parse(req.body);
    const result = await checkIn(b.token, b.screeningId, req.admin!.id);
    await audit(req, req.admin!.id, result.ok ? 'TICKET_CHECKED_IN' : 'TICKET_SCAN_REJECTED', 'ticket',
      result.ok ? result.ticketId : null, result.ok ? {} : { reason: result.reason });
    return result;
  });

  app.get('/api/admin/dashboard', { preHandler: requireRole('SUPER_ADMIN') }, async () => {
    const { rows: [d] } = await pool.query(`
      SELECT (SELECT count(*)::int FROM screenings WHERE status <> 'DRAFT') AS total_screenings,
             (SELECT count(*)::int FROM screenings WHERE status = 'SCHEDULED' AND starts_at > now()) AS upcoming_screenings,
             (SELECT count(*)::int FROM bookings WHERE status = 'ACTIVE') AS active_bookings,
             (SELECT count(*)::int FROM bookings WHERE status = 'CANCELLED') AS cancelled_bookings,
             (SELECT count(*)::int FROM booking_seats WHERE active) AS seats_booked,
             (SELECT count(*)::int FROM tickets WHERE status = 'USED') AS checked_in`);
    return d;
  });
};