import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { visualizer } from 'rollup-plugin-visualizer';

/**
 * Optional HTTPS dev mode, for testing the meeting room from a phone.
 *
 * Browsers only expose `getUserMedia` in a secure context - HTTPS, or
 * localhost as a special case - so a phone reaching the dev server at
 * `http://192.168.x.x:5173` has no camera API at all. `npm run dev:https`
 * serves the same app over HTTPS with a self-signed certificate, which is
 * enough to make the origin secure once the certificate is accepted.
 *
 * Off by default, because the certificate warning is an unnecessary step for
 * anyone working on localhost.
 */
const useHttps = process.env.VITE_HTTPS === 'true';

/**
 * Bundle analysis, on request (`npm run analyze -w @intellmeet/client`).
 *
 * A treemap to look at and the raw numbers behind it, with gzip and brotli
 * sizes, written next to the build rather than into `dist/`, which is what
 * gets deployed. Off for every other build: it adds seconds and nothing ships.
 */
const analyze = process.env.ANALYZE === 'true';
const bundleReports = analyze
  ? [
      visualizer({
        filename: 'bundle-stats/treemap.html',
        template: 'treemap',
        title: 'IntellMeet client bundle',
        gzipSize: true,
        brotliSize: true,
      }),
      visualizer({ filename: 'bundle-stats/stats.json', template: 'raw-data', gzipSize: true }),
    ]
  : [];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), ...(useHttps ? [basicSsl()] : []), ...bundleReports],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  // Only reachable through lazily loaded pages (the task board, analytics),
  // so Vite's start-up scan never sees them. Without this the dev server
  // finds them on the first visit to the page, re-bundles, and reloads it
  // mid-navigation (which the Phase 8 e2e run caught). Development only; the
  // build is unaffected.
  optimizeDeps: {
    include: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities', 'recharts'],
  },
  server: {
    port: 5173,
    // Bind to every interface in HTTPS mode so a phone on the same WiFi can
    // reach the dev server by LAN IP. Left on localhost otherwise.
    host: useHttps,
    // Mirrors production: on Vercel, `client/vercel.json` rewrites /api/* to
    // the Render service, so the browser always sees the API as same-origin
    // (which keeps the refresh-token cookie first-party). Proxying in dev
    // keeps that assumption true locally instead of relying on CORS.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:5000',
        changeOrigin: true,
      },
      // Socket.io too, and this one matters more than it looks: an HTTPS page
      // cannot open a `ws://` connection, so without a same-origin proxy the
      // phone would load the app and then fail to connect. Vercel cannot do
      // this in production - a rewrite will not carry a WebSocket upgrade -
      // which is why `VITE_SOCKET_URL` exists for the deployed build.
      '/socket.io': {
        target: process.env.VITE_DEV_API_PROXY ?? 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Per test (default 5 s). Some page tests take 3-4 s under coverage on an
    // idle laptop, so 5 s left no headroom for a CI runner. A ceiling, not a
    // delay: see asyncUtilTimeout in src/test/setup.ts.
    testTimeout: 15_000,
    // `npm run test:coverage -w @intellmeet/client` (CI). Reported, not gated:
    // the gate is on the server, where the plan sets its coverage target.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts', 'src/main.tsx'],
    },
  },
});
