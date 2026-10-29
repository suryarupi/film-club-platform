import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { createBooking } from '../services/booking.js';
import { validateFormData } from '../services/formFields.js';
import { getScreening, getSeatMap, listScreenings } from '../services/screenings.js';
import { cancelByToken, getTicketView } from '../services/tickets.js';

const Uuid = z.string().uuid();
const BookingBody = z.object({
  screeningId: Uuid,
  seatIds: z.array(Uuid).min(1).max(10),
  student: z.object({
    rollNumber: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only').transform((s) => s.toUpperCase()),
    department: z.string().trim().min(1).max(50),
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().email().max(200).optional(),
  }),
  formData: z.record(z.unknown()).optional(),
});
const TokenBody = z.object({ token: z.string().min(10).max(200) });

export const publicRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/screenings', async () => ({ screenings: await listScreenings() }));

  app.get('/api/screenings/:id', async (req) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const s = await getScreening(id);
    if (!s) throw new AppError('NOT_FOUND', 'Screening not found.', 404);
    return s;
  });

  app.get('/api/screenings/:id/seats', async (req) => {
    const { id } = z.object({ id: Uuid }).parse(req.params);
    const seats = await getSeatMap(id);
    if (seats.length === 0) throw new AppError('NOT_FOUND', 'Screening not found.', 404);
    return { seats };
  });

  // 60/min/IP: generous on purpose — a whole hostel can share one campus-wifi IP.
  app.post('/api/bookings', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const key = z.string().uuid().safeParse(req.headers['idempotency-key']);
    if (!key.success) throw new AppError('MISSING_IDEMPOTENCY_KEY', 'Something went wrong. Please refresh and try again.', 400);
    const body = BookingBody.parse(req.body);
    const formData = await validateFormData(body.screeningId, body.formData ?? {});
    const result = await createBooking({ ...body, formData, idempotencyKey: key.data });
    return reply.status(result.replayed ? 200 : 201).send(result);
  });

  app.get('/api/tickets/:token', async (req) => getTicketView(z.object({ token: z.string().max(200) }).parse(req.params).token));

  app.post('/api/tickets/cancel', async (req) => {
    await cancelByToken(TokenBody.parse(req.body).token);
    return { ok: true };
  });
};
