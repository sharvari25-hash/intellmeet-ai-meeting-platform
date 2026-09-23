import { connectMongo, disconnectMongo } from '../config/db.js';
import { env } from '../config/env.js';
import { connectRedis, disconnectRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { cleanupDemoData } from '../modules/demo/demo.cleanup.js';

/**
 * Runs the demo cleanup once, from the command line.
 *
 * The server already sweeps on a timer; this is for the impatient case -
 * clearing the workspace right before a demo without waiting for the next
 * interval. Pass an age in hours to override the default:
 *
 *   npm run demo:cleanup -w @intellmeet/server          # env default (6h)
 *   npm run demo:cleanup -w @intellmeet/server -- 0     # everything but the seed
 *
 * Redis is connected because deleting a meeting also has to evict its cached
 * view; without it the cache layer fails open and a deleted meeting would keep
 * resolving by room code until its 60s TTL expired.
 */
async function main(): Promise<void> {
  const [ageArg] = process.argv.slice(2);
  const olderThanHours = ageArg === undefined ? undefined : Number(ageArg);

  if (olderThanHours !== undefined && !Number.isFinite(olderThanHours)) {
    throw new Error(`Expected an age in hours, got "${ageArg}"`);
  }

  await connectMongo({ uri: env.MONGODB_URI });
  await connectRedis(env.REDIS_URL);

  const result = await cleanupDemoData({ olderThanHours });

  console.log(
    `\nRemoved from the demo workspace (older than ${olderThanHours ?? env.DEMO_DATA_TTL_HOURS}h):`,
  );
  console.log(`  meetings       ${result.meetings}`);
  console.log(`  chat messages  ${result.messages}`);
  console.log(`  teams          ${result.teams}`);
  console.log(`  notifications  ${result.notifications}`);
  console.log('\nThe seeded demo team and its members are never removed.\n');
}

main()
  .then(() => Promise.allSettled([disconnectMongo(), disconnectRedis()]))
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, '[demo] cleanup script failed');
    void Promise.allSettled([disconnectMongo(), disconnectRedis()]).finally(() => process.exit(1));
  });
