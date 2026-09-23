import { getRedis } from '../config/redis.js';
import { logger } from './logger.js';

/**
 * A thin JSON cache over Redis.
 *
 * Every operation is **fail-open**: if Redis is unreachable, a read reports a
 * miss and a write is dropped, so the caller falls through to MongoDB and the
 * request still succeeds. A cache outage should degrade latency, never
 * availability - which matters more than usual here, because the free Upstash
 * tier can drop connections.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const cacheKeys = {
  meeting: (id: string) => `meeting:${id}`,
  meetingByCode: (roomCode: string) => `meeting:code:${roomCode.toUpperCase()}`,
} as const;

/** Default TTL. Short enough that a missed invalidation self-heals quickly. */
export const DEFAULT_TTL_SEC = 60;

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await getRedis().get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn({ err: error, key }, '[cache] read failed, falling through to the database');
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSec = DEFAULT_TTL_SEC,
): Promise<void> {
  try {
    // 'EX' sets an expiry in seconds. Everything cached here is a derived
    // read model, so an entry that outlives its invalidation is a bug we
    // bound rather than a bug we have to prevent.
    await getRedis().set(key, JSON.stringify(value), 'EX', ttlSec);
  } catch (error) {
    logger.warn({ err: error, key }, '[cache] write failed');
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  try {
    await getRedis().del(...keys);
  } catch (error) {
    logger.warn({ err: error, keys }, '[cache] invalidation failed');
  }
}

/**
 * Read-through helper: return the cached value, or compute, cache and return it.
 *
 * `undefined` from the loader is treated as "nothing to cache", which keeps a
 * miss from being stored as a permanent negative entry.
 */
export async function cached<T>(
  key: string,
  ttlSec: number,
  load: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const hit = await cacheGet<T>(key);
  if (hit !== null && isRecord(hit)) return hit;

  const value = await load();
  if (value !== undefined) await cacheSet(key, value, ttlSec);

  return value;
}
