import { afterAll, afterEach, beforeAll, inject } from 'vitest';

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

const { connectMongo, disconnectMongo } = await import('../config/db.js');
const { setRedisClient } = await import('../config/redis.js');
const { resetRateLimits } = await import('../middleware/rateLimit.js');
const mongoose = (await import('mongoose')).default;

/**
 * Stand-in for ioredis.
 *
 * The suite must not depend on a running Redis server, but the health endpoint
 * has to see a client that answers PING. Only the methods the app actually
 * calls are implemented; the cast is the single place this shortcut is taken.
 */
const fakeRedis = {
  status: 'ready',
  ping: async () => 'PONG',
  quit: async () => 'OK',
} as unknown as import('ioredis').Redis;

beforeAll(async () => {
  await connectMongo({ uri: process.env.MONGODB_URI as string, retries: 1 });
  setRedisClient(fakeRedis);
});

afterEach(async () => {
  // Isolate tests from each other: drop every document but keep the
  // collections and their indexes, which is much faster than a full dropDatabase.
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));

  // Rate-limit counters are module-level state that would otherwise leak into
  // the next test and 429 it for no reason.
  resetRateLimits();
});

afterAll(async () => {
  setRedisClient(null);
  await disconnectMongo();
});

export { fakeRedis };
