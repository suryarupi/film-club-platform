import { createHmac, timingSafeEqual } from 'node:crypto';

function secret(): string {
  const s = process.env.TICKET_HMAC_SECRET;
  if (!s || s.length < 32) throw new Error('TICKET_HMAC_SECRET must be set (>= 32 chars)');
  return s;
}

/** Opaque QR token: "<ticketUuid>.<HMAC-SHA256>". Unforgeable without the server secret, contains no
 *  student data, and can be re-derived on demand so students can re-open their ticket. */
export function tokenFor(ticketId: string): string {
  return `${ticketId}.${createHmac('sha256', secret()).update(ticketId).digest('base64url')}`;
}

/** Returns the ticket id if the signature is valid, otherwise null. Constant-time comparison. */
export function verifyToken(token: string): string | null {
  const i = token.indexOf('.');
  if (i < 1 || token.length > 200) return null;
  const id = token.slice(0, i);
  const given = Buffer.from(token.slice(i + 1));
  const expected = Buffer.from(createHmac('sha256', secret()).update(id).digest('base64url'));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

export const qrUrl = (base: string, ticketId: string) => `${base}/validate/${tokenFor(ticketId)}`;
