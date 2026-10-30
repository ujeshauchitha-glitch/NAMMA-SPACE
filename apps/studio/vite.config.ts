import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wsSignallingPlugin from './scripts/ws-signalling-plugin';

/**
 * T19 — LAN mode is explicit: `npm run dev:lan` sets VITE_LAN=1 and only
 * then binds 0.0.0.0 and enables HTTPS (phone cameras need HTTPS on
 * insecure LAN origins). Plain `npm run dev` keeps the loopback-only HTTP
 * defaults below.
 *
 * HTTPS provider is @vitejs/plugin-basic-ssl (self-signed cert) because
 * vite-plugin-mkcert's `mkcert -install` fails without a sudo-capable
 * terminal (`security add-trusted-cert`), so its local CA cannot be
 * trusted here. Phones must accept the one-time certificate warning.
 * Recorded in DECISION_LOG D-013.
 */
const lan = process.env.VITE_LAN === '1';

// Deploy-path base is env-driven: Vercel serves the app from the domain root
// (default '/'), but a sub-path deploy can set VITE_BASE=/sub/ without code
// changes. Only affects the build; dev server behaviour is unchanged.
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [react(), wsSignallingPlugin(), ...(lan ? [basicSsl()] : [])],
  server: {
    host: lan ? '0.0.0.0' : '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
