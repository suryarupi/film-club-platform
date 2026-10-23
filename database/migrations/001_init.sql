-- Film Club schema. Integrity rules live HERE, not only in application code.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE seat_kind        AS ENUM ('STANDARD', 'DISABLED', 'RESERVED', 'VIP');
-- Only *stored* states. "Booking Open / Almost Full / Full / Closed" are derived by the backend
-- from time windows + live seat counts, so they can never drift out of sync.
CREATE TYPE screening_status AS ENUM ('DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE booking_status   AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE ticket_status    AS ENUM ('VALID', 'USED', 'CANCELLED');
CREATE TYPE admin_role       AS ENUM ('SUPER_ADMIN', 'STAFF');

CREATE TABLE admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,                       -- argon2id
  role          admin_role NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE venues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true
);

-- Irregular layouts: seats are positioned by (grid_x, grid_y); aisles/gaps are simply absent cells.
CREATE TABLE seats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id   uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  section    text NOT NULL DEFAULT 'MAIN',
  row_label  text NOT NULL,
  seat_label text NOT NULL,                          -- "B12" (renameable)
  grid_x     int  NOT NULL CHECK (grid_x >= 0),
  grid_y     int  NOT NULL CHECK (grid_y >= 0),
  kind       seat_kind NOT NULL DEFAULT 'STANDARD',
  UNIQUE (venue_id, seat_label),
  UNIQUE (venue_id, grid_x, grid_y)
);

CREATE TABLE screenings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  film_name             text NOT NULL,
  description           text NOT NULL DEFAULT '',
  poster_url            text,
  trailer_url           text,
  venue_id              uuid NOT NULL REFERENCES venues(id),
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  booking_opens_at      timestamptz NOT NULL,
  booking_closes_at     timestamptz NOT NULL,
  allowed_booking_sizes int[] NOT NULL DEFAULT '{1,2}',
  cancellations_enabled boolean NOT NULL DEFAULT false,
  cancellation_deadline timestamptz,
  status                screening_status NOT NULL DEFAULT 'DRAFT',
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (booking_closes_at > booking_opens_at),
  CHECK (cardinality(allowed_booking_sizes) > 0 AND allowed_booking_sizes <@ ARRAY[1,2,3,4,5,6,8,10])
);
CREATE INDEX screenings_starts_idx ON screenings (starts_at) WHERE status = 'SCHEDULED';

-- Admin-configurable student form, per screening.
CREATE TABLE form_fields (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id uuid NOT NULL REFERENCES screenings(id) ON DELETE CASCADE,
  field_key    text NOT NULL,
  label        text NOT NULL,
  field_type   text NOT NULL CHECK (field_type IN ('text','email','phone','number','select')),
  required     boolean NOT NULL DEFAULT true,
  validation   jsonb NOT NULL DEFAULT '{}',
  sort_order   int NOT NULL DEFAULT 0,
  UNIQUE (screening_id, field_key)
);

CREATE TABLE students (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roll_number text NOT NULL UNIQUE,
  department  text NOT NULL,
  name        text,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id    uuid NOT NULL REFERENCES screenings(id),
  student_id      uuid NOT NULL REFERENCES students(id),
  reference       text NOT NULL UNIQUE,
  status          booking_status NOT NULL DEFAULT 'ACTIVE',
  idempotency_key text NOT NULL,
  seat_count      int NOT NULL CHECK (seat_count > 0),
  form_data       jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz,
  CONSTRAINT bookings_idempotency_key_key UNIQUE (idempotency_key)
);
CREATE INDEX bookings_screening_idx ON bookings (screening_id, status);
CREATE INDEX bookings_student_idx   ON bookings (student_id);

CREATE TABLE booking_seats (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  screening_id uuid NOT NULL REFERENCES screenings(id),
  seat_id      uuid NOT NULL REFERENCES seats(id),
  active       boolean NOT NULL DEFAULT true
);
-- THE double-booking guard: at most ONE active claim per (screening, seat).
CREATE UNIQUE INDEX booking_seats_active_seat_uq ON booking_seats (screening_id, seat_id) WHERE active;
CREATE INDEX booking_seats_booking_idx ON booking_seats (booking_id);

CREATE TABLE tickets (
  id             uuid PRIMARY KEY,                   -- QR token is HMAC(secret, id); see qr.ts
  booking_id     uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  status         ticket_status NOT NULL DEFAULT 'VALID',
  checked_in_at  timestamptz,
  checked_in_by  uuid REFERENCES admins(id),
  CHECK ((status = 'USED') = (checked_in_at IS NOT NULL))
);

CREATE TABLE check_ins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL UNIQUE REFERENCES tickets(id),
  scanned_by uuid NOT NULL REFERENCES admins(id),
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  admin_id    uuid REFERENCES admins(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  detail      jsonb NOT NULL DEFAULT '{}',
  ip          inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
