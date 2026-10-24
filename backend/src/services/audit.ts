import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';

/** A failure to write the audit log must never break a gate scan or a login. */
export function audit(req: FastifyRequest, adminId: string | null, action: string, entityType: string, entityId: string | null, detail: object = {}) {
  return pool
    .query(`INSERT INTO audit_log (admin_id, action, entity_type, entity_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6)`,
      [adminId, action, entityType, entityId, JSON.stringify(detail), req.ip])
    .catch((e) => req.log.error(e, 'audit write failed'));
}