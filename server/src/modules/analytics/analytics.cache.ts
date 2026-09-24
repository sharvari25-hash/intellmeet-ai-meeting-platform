import type { Types } from 'mongoose';
import { ANALYTICS_CACHE_TTL_SEC } from '@intellmeet/shared';
import { getRedis } from '../../config/redis.js';
import { cached } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';

/**
 * The analytics cache: every aggregation is kept in Redis for five minutes,
 * and a team's entries are dropped early when something that feeds them
 * changes.
 *
 * Dropping early without finding the keys: each team has a **generation**
 * counter, and it is part of every cache key. A write that affects the team
 * (a task moved, a meeting ended, minutes corrected) increments it, so the
 * next read misses and recomputes; the old entries are never read again and
 * expire on their own TTL. One `INCR` per write, no key scans, and nothing to
 * get wrong about which ranges or time zones were cached.
 *
 * Everything is fail-open, like the rest of the cache: with Redis down a read
 * recomputes and an invalidation is a no-op, so analytics only get slower.
 */

const generationKey = (teamId: string) => `analytics:gen:${teamId}`;

/**
 * A generation outlives its cache entries by far. A counter that expires
 * after a quiet day restarts from zero, and nothing cached under the old
 * zero can still exist (entries live five minutes).
 */
const GENERATION_TTL_SEC = 24 * 60 * 60;

async function generation(teamId: string): Promise<string> {
  try {
    return (await getRedis().get(generationKey(teamId))) ?? '0';
  } catch (error) {
    logger.warn({ err: error, teamId }, '[analytics] could not read the cache generation');
    // A value no entry was written under: the read below misses and recomputes.
    return `offline-${Date.now()}`;
  }
}

/**
 * Marks the teams' analytics out of date. Called after any write that
 * changes what the dashboard shows; never throws.
 */
export async function invalidateTeamAnalytics(
  teamIds: (string | Types.ObjectId | null | undefined)[],
): Promise<void> {
  const unique = [...new Set(teamIds.flatMap((id) => (id ? [id.toString()] : [])))];
  for (const teamId of unique) {
    try {
      const key = generationKey(teamId);
      await getRedis().incr(key);
      await getRedis().expire(key, GENERATION_TTL_SEC);
    } catch (error) {
      logger.warn({ err: error, teamId }, '[analytics] could not invalidate the cache');
    }
  }
}

/**
 * Serves one aggregation from the cache, or computes and caches it.
 *
 * `parts` is everything else the result depends on (the range, the time
 * zone, today's date for "overdue"). Authorisation is never part of this:
 * the membership check runs before, on every request.
 */
export async function cachedAnalytics<T extends object>(
  kind: string,
  teamId: string,
  parts: string[],
  load: () => Promise<T>,
): Promise<T> {
  const key = ['analytics', kind, teamId, `g${await generation(teamId)}`, ...parts].join(':');
  const value = await cached(key, ANALYTICS_CACHE_TTL_SEC, load);
  // `load` never resolves to undefined, so neither does `cached`.
  return value as T;
}
