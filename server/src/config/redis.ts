import { Redis } from 'ioredis';
import type { DependencyHealth } from '@intellmeet/shared';
import { logger } from '../lib/logger.js';
import { withTimeout } from './db.js';

/**
 * Single shared Redis client.
 *
 * Held in a module-level singleton rather than created per call site so that
 * connection count stays predictable - Upstash's free tier counts connections,
 * and Phase 3 (Socket.io adapter) and Phase 6 (BullMQ) will each want a handle.
 */
let client: Redis | null = null;

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    // Connect explicitly in `connectRedis()` so a bad URL surfaces during
    // startup rather than as a background reconnect loop.
    lazyConnect: true,
    // Required by BullMQ (Phase 6): blocking commands must not be aborted
    // after N retries. Health probes are individually timed out instead.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Cap the backoff so a long outage does not stretch to minutes between
    // reconnect attempts.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    // Upstash and Render Key Value use rediss:// (TLS).
    ...(url.startsWith('rediss://') ? { tls: {} } : {}),
  });
}

/** Strips credentials so a Redis URL can safely appear in a log line. */
export function redactRedisUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//<credentials>@');
}

export async function connectRedis(url: string): Promise<Redis> {
  const next = createRedisClient(url);

  next.on('error', (error: Error) => logger.error({ err: error }, '[redis] client error'));
  next.on('reconnecting', () => logger.warn('[redis] reconnecting'));
  next.on('end', () => logger.warn('[redis] connection closed'));

  await next.connect();
  client = next;

  logger.info({ url: redactRedisUrl(url) }, '[redis] connected');
  return next;
}

/**
 * Returns the shared client, throwing if it was never connected.
 * Callers that need Redis genuinely cannot work without it, so failing loudly
 * beats handing back `null` for every call site to re-check.
 */
export function getRedis(): Redis {
  if (!client) throw new Error('Redis client is not connected. Call connectRedis() first.');
  return client;
}

/**
 * Replaces the shared client.
 *
 * Used by `connectRedis`, by the shutdown path (with `null`), and by tests,
 * which inject a stub so the suite does not need a live Redis server.
 */
export function setRedisClient(next: Redis | null): void {
  client = next;
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;

  try {
    // `quit()` drains in-flight commands; `disconnect()` would drop them.
    await client.quit();
  } catch {
    client.disconnect();
  }

  client = null;
  logger.info('[redis] disconnected');
}

/**
 * Probes Redis for the health endpoint.
 *
 * The timeout is essential here: `maxRetriesPerRequest: null` means a command
 * issued while Redis is unreachable queues indefinitely instead of rejecting,
 * which would otherwise hang the health endpoint (and with it Render's health
 * check and the Kubernetes probes).
 */
export async function pingRedis(timeoutMs = 2_000): Promise<DependencyHealth> {
  if (!client) return { status: 'down', error: 'client not connected' };

  const startedAt = performance.now();

  try {
    await withTimeout(client.ping(), timeoutMs, 'redis ping timed out');
    return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.message : 'unknown error' };
  }
}
