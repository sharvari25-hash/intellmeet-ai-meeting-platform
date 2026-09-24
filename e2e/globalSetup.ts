import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Redis from 'ioredis';
import { DEMO_GUESTS_FILE_ENV } from './helpers';

/**
 * Prepares a run: a place to record the demo guests it creates, and empty
 * rate-limit buckets.
 *
 * Every "Try Live Demo" creates a guest account, so the suite must delete the
 * guests it made (and with them the meetings they hosted). `signInAsDemo`
 * appends each guest to this file and the global teardown ends their
 * sessions. It is an environment variable because that is how Playwright
 * hands values from global setup to its worker processes.
 */
export default async function globalSetup(): Promise<void> {
  const file = path.join(tmpdir(), `intellmeet-e2e-guests-${process.pid}-${Date.now()}.jsonl`);
  writeFileSync(file, '');
  process.env[DEMO_GUESTS_FILE_ENV] = file;

  await clearRateLimits();
}

/**
 * Clears the rate-limit buckets before a run.
 *
 * Sign-in is limited to five attempts per IP and email in fifteen minutes,
 * which is right for a person and far too tight for a suite that signs the
 * same seeded account in on every run. Everything the suite does comes from
 * one IP, so without this the fifth consecutive run fails for a reason that
 * has nothing to do with the code under test.
 *
 * Only the `rl:` namespace is touched - presence, room state and the meeting
 * cache are left alone.
 */
async function clearRateLimits(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // Fail fast rather than retrying forever if Redis is not running: the
    // suite needs it anyway and a clear error beats a hung run.
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });

  try {
    await redis.connect();

    const keys = await redis.keys('rl:*');
    if (keys.length > 0) await redis.del(...keys);

    // A test runner's own output: the operator reading the terminal is the
    // audience, and there is no logger in this process.
    console.warn(`[e2e] cleared ${keys.length} rate-limit key(s)`);
  } catch (error) {
    console.warn('[e2e] could not clear rate limits:', (error as Error).message);
  } finally {
    redis.disconnect();
  }
}
