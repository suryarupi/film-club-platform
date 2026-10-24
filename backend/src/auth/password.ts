import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 defaults to argon2id.
export const hashPassword = (plain: string) => hash(plain);

let dummy: Promise<string> | undefined;
/** Verifies a password. For unknown users, verify against a dummy hash so response time doesn't reveal valid usernames. */
export async function checkPassword(stored: string | null, plain: string): Promise<boolean> {
  if (!stored) {
    dummy ??= hash('dummy-password-for-timing');
    await verify(await dummy, plain).catch(() => false);
    return false;
  }
  return verify(stored, plain).catch(() => false);
}