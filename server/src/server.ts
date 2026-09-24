import type { Server } from 'node:http';
import { createApp } from './app.js';
import { connectMongo, disconnectMongo } from './config/db.js';
import { env } from './config/env.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { startMeetingQueue, type MeetingQueue } from './jobs/meetingQueue.js';
import { logger } from './lib/logger.js';
import { startDemoCleanup, stopDemoCleanup } from './modules/demo/demo.cleanup.js';
import { attachRedisAdapter, closeSocketServer, createSocketServer } from './sockets/index.js';

/**
 * Process entry point: owns the external connections, the HTTP listener and
 * the process lifecycle.
 */
async function bootstrap(): Promise<void> {
  // Connect before listening so the service never accepts a request it cannot
  // serve. `connectMongo` retries with backoff, which matters on Render where
  // the container starts before Atlas is necessarily reachable.
  await connectMongo({ uri: env.MONGODB_URI });
  await connectRedis(env.REDIS_URL);

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV },
      `[server] listening on http://localhost:${env.PORT}`,
    );
  });

  // Socket.io shares the HTTP listener: Render's free tier gives one web
  // service on one port, so REST and WebSocket cannot be split apart.
  const io = createSocketServer(server);
  attachRedisAdapter(io);

  // Housekeeping for the demo workspace: idle guest accounts and stale
  // content. Age-based and in-process: see modules/demo/demo.cleanup.ts for
  // why it is not a reset endpoint.
  startDemoCleanup();

  // The post-meeting AI queue. The worker runs in this process when
  // RUN_WORKER_IN_PROCESS=true, because Render's free tier has no workers.
  const meetingQueue = startMeetingQueue();

  registerShutdownHandlers(server, meetingQueue);
}

/**
 * Graceful shutdown.
 *
 * Render sends SIGTERM on every deploy and when a free-tier instance sleeps,
 * then force-kills shortly after. Without this, in-flight requests are cut
 * mid-response and Mongo/Redis connections are left for the server to time
 * out. Kubernetes (Phase 11) has the same contract.
 */
function registerShutdownHandlers(server: Server, meetingQueue: MeetingQueue): void {
  let shuttingDown = false;

  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    // A second SIGTERM (or an error during shutdown) must not restart the
    // sequence and close things twice.
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, '[server] shutting down');

    stopDemoCleanup();

    // Close Socket.io first so connected clients get a clean disconnect and
    // reconnect to another instance, rather than having their sockets cut
    // from under them when the HTTP server dies.
    await closeSocketServer();

    // Stop accepting new connections; the callback fires once in-flight
    // requests have finished.
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));

    // Keep-alive sockets would otherwise hold the server open until their
    // idle timeout, well past Render's kill window.
    const forceTimer = setTimeout(() => {
      logger.warn(
        { timeoutMs: env.SHUTDOWN_TIMEOUT_MS },
        '[server] shutdown timeout reached, forcing sockets closed',
      );
      server.closeAllConnections();
    }, env.SHUTDOWN_TIMEOUT_MS);
    // Do not let the timer itself keep the event loop alive.
    forceTimer.unref();

    try {
      await closed;
      clearTimeout(forceTimer);

      // The worker waits for its running jobs to finish (or hands them back
      // to the queue) before Mongo and Redis go away underneath them.
      await meetingQueue.close().catch((error: unknown) => {
        logger.warn({ err: error }, '[server] meeting queue did not close cleanly');
      });

      // Close dependencies only after the HTTP server, so no handler is still
      // mid-query when the connection disappears.
      await Promise.allSettled([disconnectMongo(), disconnectRedis()]);

      logger.info('[server] shutdown complete');
    } catch (error) {
      logger.error({ err: error }, '[server] error during shutdown');
      exitCode = 1;
    }

    process.exit(exitCode);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // An unhandled throw leaves the process in an unknown state. Log it, then
  // shut down cleanly so the platform can start a fresh instance.
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, '[server] uncaught exception');
    void shutdown('uncaughtException', 1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, '[server] unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, '[server] failed to start');
  process.exit(1);
});
