export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  // The only browser origin allowed to make cookie-authenticated state-changing requests (CSRF defence).
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
  trustProxy: process.env.TRUST_PROXY === 'true',
  sessionHours: 12,
  cookieName: 'fc_session',
};