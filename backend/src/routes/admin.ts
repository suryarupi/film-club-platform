import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../auth/context.js';
import { audit } from '../services/audit.js';
import * as S from '../services/adminScreenings.js';
import * as V from '../services/venues.js';

const Uuid = z.string().uuid();
const IdParam = z.object({ id: Uuid });
const Iso = z.string().datetime({ offset: true });
const SeatKind = z.enum(['STANDARD', 'DISABLED', 'RESERVED', 'VIP']);
const SeatLabel = z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only');
// Only http(s) links: blocks "javascript:" style URLs from ever reaching the website.
const HttpUrl = z.string().max(500).url().refine((u) => /^https?:\/\//i.test(u), 'Must start with http:// or https://');
const ALLOWED_SIZES = [1, 2, 3, 4, 5, 6, 8, 10];
const Sizes = z.array(z.number().int().refine((n) => ALLOWED_SIZES.includes(n), 'Allowed sizes: 1-6, 8, 10')).min(1).max(8)
  .transform((a) => [...new Set(a)].sort((x, y) => x - y));

const VenueCreate = z.object({ name: z.string().trim().min(1).max(100), description: z.string().max(2000).optional() });
const VenueUpdate = z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().max(2000).optional(), active: z.boolean().optional() });
const Layout = z.object({
  rows: z.number().int().min(1).max(60), cols: z.number().int().min(1).max(60),
  aisleAfterColumns: z.array(z.number().int().min(1).max(60)).max(20).default([]), replace: z.boolean().default(false),
});
const SeatAdd = z.object({
  label: SeatLabel, row: SeatLabel, x: z.number().int().min(0).max(500), y: z.number().int().min(0).max(500),
  section: z.string().trim().min(1).max(30).default('MAIN'), kind: SeatKind.default('STANDARD'),
});
const SeatKindBody = z.object({ seatIds: z.array(Uuid).min(1).max(500), kind: SeatKind });

const ScreeningCreate = z.object({
  filmName: z.string().trim().min(1).max(200), description: z.string().max(5000).optional(),
  posterUrl: HttpUrl.nullable().optional(), trailerUrl: HttpUrl.nullable().optional(), venueId: Uuid,
  startsAt: Iso, endsAt: Iso, bookingOpensAt: Iso, bookingClosesAt: Iso,
  allowedBookingSizes: Sizes.optional(), cancellationsEnabled: z.boolean().optional(),
  cancellationDeadline: Iso.nullable().optional(), status: z.enum(['DRAFT', 'SCHEDULED']).optional(),
});
const ScreeningUpdate = ScreeningCreate.partial().extend({ status: z.enum(['DRAFT', 'SCHEDULED', 'COMPLETED']).optional() });

const compiles = (p: string) => { try { new RegExp(p); return true; } catch { return false; } };
const FormFieldsBody = z.object({
  fields: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Lowercase letters, numbers and underscores'),
    label: z.string().trim().min(1).max(100),
    type: z.enum(['text', 'email', 'phone', 'number', 'select']),
    required: z.boolean(),
    validation: z.object({
      pattern: z.string().max(200).refine(compiles, 'Invalid pattern').optional(),
      minLength: z.number().int().min(0).max(1000).optional(),
      maxLength: z.number().int().min(1).max(1000).optional(),
      options: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
    }).strict().default({}),
  }).refine((f) => f.type !== 'select' || (f.validation.options?.length ?? 0) > 0, 'Select fields need options'))
    .max(20).refine((a) => new Set(a.map((f) => f.key)).size === a.length, 'Field keys must be unique'),
});

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Every route in this file is Super Admin only (the hook is scoped to this plugin).
  app.addHook('preHandler', requireRole('SUPER_ADMIN'));
  const who = (req: FastifyRequest) => req.admin!.id;

  // ---- venues ----
  app.get('/api/admin/venues', async () => ({ venues: await V.listVenues() }));

  app.post('/api/admin/venues', async (req, reply) => {
    const b = VenueCreate.parse(req.body);
    const v = await V.createVenue(b.name, b.description ?? '');
    await audit(req, who(req), 'VENUE_CREATED', 'venue', v.id, { name: b.name });
    return reply.status(201).send(v);
  });

  app.put('/api/admin/venues/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const v = await V.updateVenue(id, VenueUpdate.parse(req.body));
    await audit(req, who(req), 'VENUE_UPDATED', 'venue', id, req.body as object);
    return v;
  });

  app.get('/api/admin/venues/:id/seats', async (req) => V.getVenueSeats(IdParam.parse(req.params).id));

  app.post('/api/admin/venues/:id/layout', async (req) => {
    const { id } = IdParam.parse(req.params);
    const b = Layout.parse(req.body);
    const r = await V.generateLayout(id, b);
    await audit(req, who(req), 'LAYOUT_GENERATED', 'venue', id, { rows: b.rows, cols: b.cols, replace: b.replace });
    return r;
  });

  app.post('/api/admin/venues/:id/seats', async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const s = await V.addSeat(id, SeatAdd.parse(req.body));
    await audit(req, who(req), 'SEAT_ADDED', 'seat', s.id, { venueId: id, label: s.label });
    return reply.status(201).send(s);
  });

  app.patch('/api/admin/venues/:id/seats/kind', async (req) => {
    const { id } = IdParam.parse(req.params);
    const b = SeatKindBody.parse(req.body);
    const r = await V.setSeatKind(id, b.seatIds, b.kind);
    await audit(req, who(req), 'SEATS_KIND_CHANGED', 'venue', id, { kind: b.kind, count: r.updated });
    return r;
  });

  app.patch('/api/admin/seats/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const { label } = z.object({ label: SeatLabel }).parse(req.body);
    const r = await V.renameSeat(id, label);
    await audit(req, who(req), 'SEAT_RENAMED', 'seat', id, { label });
    return r;
  });

  app.delete('/api/admin/seats/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    await V.deleteSeat(id);
    await audit(req, who(req), 'SEAT_DELETED', 'seat', id);
    return { ok: true };
  });

  // ---- screenings ----
  app.get('/api/admin/screenings', async () => ({ screenings: await S.listAllScreenings() }));
  app.get('/api/admin/screenings/:id', async (req) => S.getScreeningAdmin(IdParam.parse(req.params).id));

  app.post('/api/admin/screenings', async (req, reply) => {
    const r = await S.createScreening(ScreeningCreate.parse(req.body));
    await audit(req, who(req), 'SCREENING_CREATED', 'screening', r.id);
    return reply.status(201).send(r);
  });

  app.put('/api/admin/screenings/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    const r = await S.updateScreening(id, ScreeningUpdate.parse(req.body));
    await audit(req, who(req), 'SCREENING_UPDATED', 'screening', id, { fields: Object.keys(req.body as object) });
    return r;
  });

  app.post('/api/admin/screenings/:id/cancel', async (req) => {
    const { id } = IdParam.parse(req.params);
    const r = await S.cancelScreening(id);
    await audit(req, who(req), 'SCREENING_CANCELLED', 'screening', id, r);
    return r;
  });

  app.put('/api/admin/screenings/:id/form-fields', async (req) => {
    const { id } = IdParam.parse(req.params);
    const r = await S.setFormFields(id, FormFieldsBody.parse(req.body).fields);
    await audit(req, who(req), 'FORM_FIELDS_UPDATED', 'screening', id, r);
    return r;
  });
};