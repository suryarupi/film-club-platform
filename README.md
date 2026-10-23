## Progress log

### Day 1 - Foundation (done)
- PostgreSQL schema with constraints (partial unique index prevents double booking)
- Transactional booking engine with idempotency and atomic cancellation
- HMAC-signed QR tokens and atomic check-in
- 14 concurrency tests passing against a real PostgreSQL

### Day 2 - API and auth (in progress)
- Fastify API, admin login with argon2id, HttpOnly cookie sessions
- Role-based access: Super Admin and Screening Staff
- Rate limiting and input validation

## Running locally (Ubuntu)
1. Install PostgreSQL and create a test database named `filmclub_test`
2. `cd backend && npm install`
3. `DATABASE_URL=postgres://postgres:<password>@localhost:5432/filmclub_test npm test`
EOF