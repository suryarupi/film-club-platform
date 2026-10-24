-- Server-side admin sessions. Only a SHA-256 hash of the cookie token is stored,
-- so a database leak does not hand out usable sessions.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  admin_id   uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_admin_idx   ON sessions (admin_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);