import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { pool } from '../db.js';
import { AppError } from '../errors.js';

export type Role = 'SUPER_ADMIN' | 'STAFF';
export interface AdminCtx { id: string; username: string; role: Role }

declare module 'fastify' {
  interface FastifyRequest { admin: AdminCtx | null }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(adminId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES ($1,$2, now() + make_interval(hours => $3))`,
    [sha(token), adminId, config.sessionHours]);
  return token;
}
export const destroySession = (token: string) => pool.query(`DELETE FROM sessions WHERE token_hash=$1`, [sha(token)]);

async function lookup(token: string): Promise<AdminCtx | null> {
  const { rows: [a] } = await pool.query(
    `SELECT a.id, a.username, a.role FROM sessions s JOIN admins a ON a.id = s.admin_id
      WHERE s.token_hash=$1 AND s.expires_at > now() AND a.active`, [sha(token)]);
  return a ?? null;
}

/** Resolves the session cookie on every request and enforces the CSRF origin check for cookie-authenticated writes. */
export function installAuth(app: FastifyInstance) {
  app.decorateRequest('admin', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[config.cookieName];
    req.admin = token ? await lookup(token) : null;
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (req.admin && unsafe && req.headers.origin !== config.allowedOrigin)
      throw new AppError('BAD_ORIGIN', 'Request blocked.', 403);
  });
}

export const requireRole = (...roles: Role[]) => async (req: FastifyRequest) => {
  if (!req.admin) throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', 401);
  if (!roles.includes(req.admin.role)) throw new AppError('FORBIDDEN', 'You do not have permission to do that.', 403);
};