import type { HealthResponse } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { pingMongo } from '../../config/db.js';
import { pingRedis } from '../../config/redis.js';

/**
 * `npm_package_version` is only set when the process is started through npm.
 * Render runs `node dist/server.js` directly, hence the literal fallback.
 */
const VERSION = process.env.npm_package_version ?? '0.1.0';

/**
 * Builds the health payload by probing every external dependency in parallel.
 *
 * Parallel matters: the endpoint backs Render's health check and Kubernetes
 * probes, so its latency is the sum of the slowest probe, not all of them.
 * Each probe has its own timeout and resolves (never rejects), so one dead
 * dependency degrades the report instead of breaking the endpoint.
 */
export async function getHealth(): Promise<HealthResponse> {
  const [mongo, redis] = await Promise.all([pingMongo(), pingRedis()]);
  const dependencies = { mongo, redis };

  const allUp = Object.values(dependencies).every((dep) => dep.status === 'up');

  return {
    status: allUp ? 'ok' : 'degraded',
    service: 'intellmeet-server',
    version: VERSION,
    environment: env.NODE_ENV,
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies,
  };
}
