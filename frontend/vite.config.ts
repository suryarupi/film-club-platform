import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In development, /api requests are forwarded to the backend, so the browser sees one origin (no CORS needed).
// host:true lets you open the site from your phone on the same wifi.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:3000' } },
});
