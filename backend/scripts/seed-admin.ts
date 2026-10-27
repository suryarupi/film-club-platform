// Usage: ADMIN_PASSWORD='a-long-passphrase' npm run seed:admin -- <username> [SUPER_ADMIN|STAFF]
import { hashPassword } from '../src/auth/password.js';
import { pool } from '../src/db.js';

const [username, role = 'SUPER_ADMIN'] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? '';
if (!username || !['SUPER_ADMIN', 'STAFF'].includes(role) || password.length < 12) {
  console.error("Usage: ADMIN_PASSWORD='<12+ chars>' npm run seed:admin -- <username> [SUPER_ADMIN|STAFF]");
  process.exit(1);
}
await pool.query(
  `INSERT INTO admins (username, password_hash, role) VALUES ($1,$2,$3)
   ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = true`,
  [username, await hashPassword(password), role]);
console.log(`Admin "${username}" saved as ${role}`);
await pool.end();