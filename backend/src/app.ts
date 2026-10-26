import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import { installAuth } from './auth/context.js';
import { config } from './config.js';
import { pool } from './db.js';
import { AppError } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { staffRoutes } from './routes/staff.js';

export async function buildApp(opts: { logger?: boolean; rateLimits?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: config.trustProxy, bodyLimit: 100_000 });

  await app.register(helmet, { contentSecurityPolicy: false }); // API only; CSP belongs on the frontend host
  await app.register(cookie);
  if (opts.rateLimits ?? true) await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  installAuth(app);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError)
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'Please check the details and try again.', fields: err.flatten().fieldErrors } });
    if (err.statusCode === 429)
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'High traffic right now. Please wait a moment and try again.' } });
    if (err.statusCode && err.statusCode < 500)
      return reply.status(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: 'Invalid request.' } });
    req.log.error(err); // full detail stays in server logs only
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  });
  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));

  app.get('/api/health', async () => { await pool.query('SELECT 1'); return { ok: true }; });
  await app.register(authRoutes);
  await app.register(publicRoutes);
  await app.register(staffRoutes);
  return app;
}