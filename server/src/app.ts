import express, { type Express } from 'express';
import { healthRouter } from './modules/health/health.routes.js';

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` (which owns the listening socket) so tests
 * can drive the app through Supertest without binding a real port.
 * The full middleware pipeline (requestId -> pino-http -> helmet -> cors ->
 * body limits -> sanitisation -> routes -> 404 -> error handler) arrives in
 * Phase 1; Phase 0 only needs a routable app.
 */
export function createApp(): Express {
  const app = express();

  // Render and Vercel sit in front of this process, so the real client IP is
  // in X-Forwarded-For. Without this, rate limiting (Phase 2) would bucket
  // every request under the proxy's IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));

  app.use('/api/health', healthRouter);

  return app;
}
