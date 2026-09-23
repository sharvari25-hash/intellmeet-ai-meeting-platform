import mongoose from 'mongoose';
import type { DependencyHealth } from '@intellmeet/shared';
import { logger } from '../lib/logger.js';

/**
 * Reject queries that reference fields absent from the schema instead of
 * silently matching everything - a common source of "why did this return the
 * whole collection?" bugs.
 */
mongoose.set('strictQuery', true);

export interface ConnectMongoOptions {
  uri: string;
  /** Total attempts before giving up. */
  retries?: number;
  /** Delay before the first retry; doubles each attempt. */
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Strips credentials so a connection string can safely appear in a log line. */
export function redactMongoUri(uri: string): string {
  return uri.replace(/\/\/[^@/]*@/, '//<credentials>@');
}

let listenersAttached = false;

function attachConnectionListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('disconnected', () => logger.warn('[mongo] disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('[mongo] reconnected'));
  mongoose.connection.on('error', (error: Error) =>
    logger.error({ err: error }, '[mongo] connection error'),
  );
}

/**
 * Connects to MongoDB, retrying with exponential backoff.
 *
 * Retrying matters on the target hosting: Render boots the container before
 * Atlas has necessarily finished accepting the connection, and a cold free-tier
 * cluster can take a few seconds. Failing instantly would crash-loop the
 * service for a condition that resolves itself.
 */
export async function connectMongo({
  uri,
  retries = 5,
  baseDelayMs = 500,
}: ConnectMongoOptions): Promise<typeof mongoose> {
  attachConnectionListeners();

  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        // Fail a connection attempt quickly so the backoff loop, not the
        // driver's own 30s default, controls the retry timing.
        serverSelectionTimeoutMS: 5_000,
        // Free tiers cap connections; a small pool leaves room for the worker.
        maxPoolSize: 10,
        minPoolSize: 1,
      });

      logger.info({ uri: redactMongoUri(uri) }, '[mongo] connected');
      return mongoose;
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === retries;

      logger.warn(
        { attempt, retries, err: error },
        `[mongo] connection attempt ${attempt}/${retries} failed`,
      );

      if (isLastAttempt) break;

      // Exponential backoff with jitter, so parallel instances restarting at
      // the same moment do not retry in lockstep.
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay + Math.random() * 250);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to connect to MongoDB');
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('[mongo] disconnected');
}

/**
 * Probes MongoDB for the health endpoint.
 *
 * Runs a real `ping` command rather than just reading `readyState`, because a
 * socket can look connected while the server behind it is unresponsive.
 */
export async function pingMongo(timeoutMs = 2_000): Promise<DependencyHealth> {
  if (mongoose.connection.readyState !== 1) {
    return { status: 'down', error: `readyState=${mongoose.connection.readyState}` };
  }

  const startedAt = performance.now();

  try {
    const db = mongoose.connection.db;
    if (!db) return { status: 'down', error: 'no database handle' };

    await withTimeout(db.admin().command({ ping: 1 }), timeoutMs, 'mongo ping timed out');
    return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.message : 'unknown error' };
  }
}

/** Bounds a probe so a hung dependency cannot hang the health endpoint. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
