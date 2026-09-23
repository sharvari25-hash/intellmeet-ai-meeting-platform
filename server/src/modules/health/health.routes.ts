import { Router } from 'express';
import { healthResponseSchema } from '@intellmeet/shared';
import { getHealth } from './health.service.js';

export const healthRouter: Router = Router();

/**
 * GET /api/health - liveness.
 *
 * Always returns 200 while the process can answer, with per-dependency detail
 * in the body. It deliberately does NOT fail when Mongo or Redis is down:
 * Render restarts a service whose health check fails, and restarting the API
 * does nothing to fix a database outage - it just turns a partial outage into
 * a total one. Unauthenticated so it can also serve the free-tier keep-alive
 * ping and Kubernetes' liveness probe.
 */
healthRouter.get('/', async (_req, res) => {
  // Parsing our own response guarantees the handler can never drift from the
  // schema the client uses to decode it.
  res.status(200).json(healthResponseSchema.parse(await getHealth()));
});

/**
 * GET /api/health/ready - readiness.
 *
 * Returns 503 when any dependency is down, which is what a Kubernetes
 * readiness probe (Phase 11) and a load balancer need: take this instance out
 * of rotation, but leave it running.
 */
healthRouter.get('/ready', async (_req, res) => {
  const health = await getHealth();
  res.status(health.status === 'ok' ? 200 : 503).json(healthResponseSchema.parse(health));
});
