import { afterAll, afterEach, beforeAll, beforeEach, inject, vi } from 'vitest';

/**
 * Runs before every test file, and crucially before the module under test is
 * imported.
 *
 * `MONGODB_URI` must be in `process.env` before `config/env.ts` is first
 * evaluated, because that module validates the environment at import time and
 * exits the process if a required variable is missing. Static imports are
 * hoisted above this assignment, so the app modules are pulled in with a
 * dynamic `import()` afterwards.
 */
process.env.MONGODB_URI = inject('mongoUri');

// Recordings uploaded without Cloudinary go to disk. Tests write theirs to a
// throwaway directory per worker rather than the developer's `.data/` - but
// one that also sits under a dot-directory, like the real default: serving
// from such a path is refused by Express unless handled, which a tidier test
// path hid until the Phase 7 player first played a recording back.
const { tmpdir } = await import('node:os');
const path = (await import('node:path')).default;
const testRoot = path.join(tmpdir(), `intellmeet-test-${process.pid}`);
const recordingsDir = path.join(testRoot, '.data', 'recordings');
process.env.RECORDINGS_DIR = recordingsDir;

const { connectMongo, disconnectMongo } = await import('../config/db.js');
const { setRedisClient } = await import('../config/redis.js');
const { resetRateLimits } = await import('../middleware/rateLimit.js');
const mongoose = (await import('mongoose')).default;

const { createFakeRedis } = await import('./fakeRedis.js');

/**
 * In-memory Redis for the whole suite: presence, room membership and the
 * meeting cache all run against it, so those code paths are genuinely
 * exercised without the tests needing a live server.
 */
const fakeRedis = createFakeRedis();

beforeAll(async () => {
  await connectMongo({ uri: process.env.MONGODB_URI as string, retries: 1 });
  setRedisClient(fakeRedis);
});

/**
 * No test may reach Cloudinary. Deleting a meeting with a Cloudinary
 * recording asks it to destroy the asset, and the suite runs with fake
 * credentials. Stubbed before every test, so a file that restores its own
 * mocks cannot undo it; tests that care inspect or override the spy.
 */
const { v2: cloudinary } = await import('cloudinary');
beforeEach(() => {
  vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });
});

afterEach(async () => {
  // Isolate tests from each other: drop every document but keep the
  // collections and their indexes, which is much faster than a full dropDatabase.
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));

  // Rate-limit counters are module-level state that would otherwise leak into
  // the next test and 429 it for no reason.
  resetRateLimits();

  // Same for cached meetings, presence sets and room hashes.
  fakeRedis.reset();
  setRedisClient(fakeRedis);
});

afterAll(async () => {
  setRedisClient(null);
  await disconnectMongo();
  const { rm } = await import('node:fs/promises');
  await rm(testRoot, { recursive: true, force: true });
});

export { fakeRedis };
