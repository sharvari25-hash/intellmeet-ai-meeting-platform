import { Router } from 'express';
import { healthResponseSchema, type HealthResponse } from '@intellmeet/shared';
import { env } from '../../config/env.js';

export const healthRouter: Router = Router();

/**
 * GET /api/health
 *
 * Deliberately dependency-free and unauthenticated so it can serve three
 * jobs at once: the Render health check, the Kubernetes readiness/liveness
 * probes, and the free-tier keep-alive ping. Phase 1 extends the payload
 * with MongoDB and Redis sub-checks.
 */
healthRouter.get('/', (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    service: 'intellmeet-server',
    version: process.env.npm_package_version ?? '0.1.0',
    environment: env.NODE_ENV,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };

  // Parsing our own response guarantees the handler can never drift from the
  // schema the client uses to decode it.
  res.status(200).json(healthResponseSchema.parse(body));
});
