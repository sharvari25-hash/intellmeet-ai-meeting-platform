import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import {
  describeFailure,
  isRetryable,
  markAwaitingRetry,
  markProcessingFailed,
  processMeeting,
} from '../modules/ai/ai.pipeline.js';

/** Queue and job names, shared by the producer and any separate worker process. */
export const MEETING_QUEUE = 'meeting-ai';
export const PROCESS_MEETING_JOB = 'process-meeting';

interface ProcessMeetingData {
  meetingId: string;
}

/**
 * What the rest of the app sees of the job queue.
 *
 * An interface rather than BullMQ directly because BullMQ runs Lua scripts on
 * a real Redis, which the test suite deliberately does not have. Tests use
 * `MemoryQueue` and call `processMeeting` themselves; the running server uses
 * BullMQ.
 */
export interface MeetingQueue {
  enqueue(meetingId: string): Promise<void>;
  close(): Promise<void>;
}

/** Records what was enqueued without running it. Tests, and before startup. */
export class MemoryQueue implements MeetingQueue {
  readonly jobs: string[] = [];

  async enqueue(meetingId: string): Promise<void> {
    this.jobs.push(meetingId);
  }

  async close(): Promise<void> {}
}

let queue: MeetingQueue = new MemoryQueue();

export function getMeetingQueue(): MeetingQueue {
  return queue;
}

export function setMeetingQueue(next: MeetingQueue): void {
  queue = next;
}

/**
 * The job body as BullMQ sees it.
 *
 * Errors that retrying cannot fix are rethrown as `UnrecoverableError`, which
 * tells BullMQ to stop immediately instead of spending the remaining attempts
 * (and minutes of backoff) on a meeting that was deleted.
 */
async function runJob(job: Job<ProcessMeetingData>): Promise<void> {
  try {
    await processMeeting(job.data.meetingId);
  } catch (error) {
    if (!isRetryable(error)) throw new UnrecoverableError(describeFailure(error));
    throw error;
  }
}

class BullMeetingQueue implements MeetingQueue {
  private readonly queue: Queue<ProcessMeetingData>;
  private worker: Worker<ProcessMeetingData> | null = null;

  constructor(runWorker: boolean) {
    // Dedicated connections: a worker blocks on its connection while waiting
    // for jobs, so sharing the app's client would stall every other command.
    this.queue = new Queue(MEETING_QUEUE, {
      connection: getRedis().duplicate(),
      defaultJobOptions: {
        attempts: env.AI_JOB_ATTEMPTS,
        // 10s, 20s, 40s... - long enough for a per-minute rate limit to reset.
        backoff: { type: 'exponential', delay: env.AI_JOB_BACKOFF_MS },
        // Keep a little history for debugging without growing Redis forever -
        // Upstash's free tier is 256 MB.
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    if (runWorker) this.worker = createWorker();
  }

  async enqueue(meetingId: string): Promise<void> {
    // A unique id per run, not the meeting id: BullMQ ignores an add whose id
    // it already holds, which would silently swallow a retry after a failure.
    // Double-enqueueing is prevented upstream by the atomic status change.
    await this.queue.add(
      PROCESS_MEETING_JOB,
      { meetingId },
      { jobId: `${meetingId}-${Date.now()}` },
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

/**
 * Consumes the queue. Used in-process by the web server (Render's free tier
 * has no background workers) or on its own by `npm run worker`.
 */
export function createWorker(): Worker<ProcessMeetingData> {
  const worker = new Worker<ProcessMeetingData>(MEETING_QUEUE, runJob, {
    connection: getRedis().duplicate(),
    // Two at once: transcription is network-bound, but a free-tier API key
    // will not thank us for more parallelism than that.
    concurrency: 2,
  });

  worker.on('failed', (job, error) => {
    if (!job) return;

    const meetingId = job.data.meetingId;
    const final =
      error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);

    logger.warn(
      { err: error, meetingId, attempt: job.attemptsMade, final },
      '[ai] process-meeting attempt failed',
    );

    const settle = final
      ? markProcessingFailed(
          meetingId,
          error instanceof UnrecoverableError ? error.message : describeFailure(error),
        )
      : markAwaitingRetry(meetingId);

    void settle.catch((settleError: unknown) =>
      logger.error({ err: settleError, meetingId }, '[ai] could not record the job outcome'),
    );
  });

  // Connection-level problems (Redis dropped). BullMQ reconnects on its own.
  worker.on('error', (error) => logger.error({ err: error }, '[ai] worker error'));

  logger.info({ queue: MEETING_QUEUE }, '[ai] worker started');
  return worker;
}

/** Switches the app onto BullMQ. Called once Redis is connected. */
export function startMeetingQueue(): MeetingQueue {
  const bull = new BullMeetingQueue(env.RUN_WORKER_IN_PROCESS);
  queue = bull;
  logger.info(
    { provider: env.AI_PROVIDER, workerInProcess: env.RUN_WORKER_IN_PROCESS },
    '[ai] meeting queue ready',
  );
  return bull;
}
