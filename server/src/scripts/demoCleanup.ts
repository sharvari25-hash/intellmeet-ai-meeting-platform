import { connectMongo, disconnectMongo } from '../config/db.js';
import { env } from '../config/env.js';
import { connectRedis, disconnectRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import { restoreDemoBoard } from '../modules/demo/demo.board.js';
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
 * With `-- 0` every guest account goes too, including any still signed in,
 * and the demo board's sample tasks are put back as seeded, so run it before
 * a demo rather than during one.
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

  // Clearing the decks before a demo also puts the sample tasks back where
  // the seed left them, rather than waiting for the board to go quiet.
  const boardRestored = olderThanHours === 0 ? await restoreDemoBoard({ force: true }) : false;

  console.log(
    `\nRemoved from the demo workspace (older than ${olderThanHours ?? env.DEMO_DATA_TTL_HOURS}h):`,
  );
  console.log(`  guest accounts ${result.guests}`);
  console.log(`  meetings       ${result.meetings}`);
  console.log(`  chat messages  ${result.messages}`);
  console.log(`  teams          ${result.teams}`);
  console.log(`  tasks          ${result.tasks}`);
  console.log(`  notifications  ${result.notifications}`);
  if (boardRestored) console.log('  sample tasks   put back as seeded');
  console.log(
    '\nThe seeded demo team, its members, sample meetings and sample tasks are never removed.\n',
  );
}

main()
  .then(() => Promise.allSettled([disconnectMongo(), disconnectRedis()]))
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, '[demo] cleanup script failed');
    void Promise.allSettled([disconnectMongo(), disconnectRedis()]).finally(() => process.exit(1));
  });
