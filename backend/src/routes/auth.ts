import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { checkPassword } from '../auth/password.js';
import { createSession, destroySession, requireRole } from '../auth/context.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError } from '../errors.js';
import { audit } from '../services/audit.js';

const Login = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(200) });

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Brute-force protection: 5 attempts/minute/IP (no-op when the rate-limit plugin isn't registered, e.g. most tests).
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = Login.parse(req.body);
    const { rows: [a] } = await pool.query(`SELECT id, username, role, password_hash FROM admins WHERE username=$1 AND active`, [body.username]);
    const ok = await checkPassword(a?.password_hash ?? null, body.password);
    if (!a || !ok) {
      await audit(req, null, 'ADMIN_LOGIN_FAILED', 'admin', null, { username: body.username });
      throw new AppError('INVALID_CREDENTIALS', 'Incorrect username or password.', 401);
    }
    const token = await createSession(a.id);
    reply.setCookie(config.cookieName, token, {
      httpOnly: true, sameSite: 'strict', secure: config.isProd, path: '/', maxAge: config.sessionHours * 3600,
    });
    await audit(req, a.id, 'ADMIN_LOGIN', 'admin', a.id);
    return { username: a.username, role: a.role };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[config.cookieName];
    if (token) await destroySession(token);
    if (req.admin) await audit(req, req.admin.id, 'ADMIN_LOGOUT', 'admin', req.admin.id);
    reply.clearCookie(config.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireRole('SUPER_ADMIN', 'STAFF') }, async (req) => ({
    username: req.admin!.username, role: req.admin!.role,
  }));
};