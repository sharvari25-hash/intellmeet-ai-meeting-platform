import { connectMongo, disconnectMongo } from '../config/db.js';
import { env } from '../config/env.js';
import { connectRedis, disconnectRedis } from '../config/redis.js';
import { createWorker } from '../jobs/meetingQueue.js';
import { logger } from '../lib/logger.js';

/**
 * A standalone AI worker, for deployments that can afford a separate process.
 *
 * Production on Render's free tier does not use this - the web process runs
 * the worker itself (RUN_WORKER_IN_PROCESS=true). It exists for the scalable
 * path (Kubernetes, Phase 11), where the API sets RUN_WORKER_IN_PROCESS=false
 * and this scales independently of web traffic.
 *
 *   npm run worker -w @intellmeet/server
 */
async function main(): Promise<void> {
  await connectMongo({ uri: env.MONGODB_URI });
  await connectRedis(env.REDIS_URL);

  const worker = createWorker();

  const stop = async (signal: string) => {
    logger.info({ signal }, '[worker] shutting down');
    // Lets the jobs in progress finish rather than abandoning them mid-call.
    await worker.close();
    await Promise.allSettled([disconnectMongo(), disconnectRedis()]);
    process.exit(0);
  };

  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, '[worker] failed to start');
  process.exit(1);
});
