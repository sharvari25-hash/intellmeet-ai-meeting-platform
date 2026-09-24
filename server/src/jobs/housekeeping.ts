import { env, isTest } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { restoreDemoBoard } from '../modules/demo/demo.board.js';
import { cleanupDemoData } from '../modules/demo/demo.cleanup.js';
import { refreshDemoHistory } from '../modules/demo/demo.history.js';
import { endAbandonedMeetings } from '../modules/meetings/meeting.sweep.js';

/**
 * The periodic sweep: small jobs that keep shared state honest, run in-process.
 *
 * An interval in the web process rather than a platform cron: Render's free
 * tier has no scheduler, and none of this is work that deserves its own
 * service. Every job is idempotent, so several instances running it at once
 * waste a little effort rather than doing harm.
 *
 * Two cadences:
 *
 * - **Every 5 minutes, first 30 seconds after startup:** end live meetings
 *   everybody has left. Cheap (one indexed query for the handful of live
 *   meetings), and it has to be frequent for "ended 10-15 minutes after the
 *   last person left" to be true. The first pass is the "on startup" check
 *   that catches a meeting left live across a restart; the 30 seconds give
 *   people who were mid-call time to reconnect and rejoin first. The same
 *   pass puts the demo board's sample tasks back once the board has been
 *   quiet for `DEMO_BOARD_RESET_IDLE_MIN` (a single indexed read otherwise),
 *   and, once a week, moves the seeded history forward so the analytics'
 *   "last eight weeks" stay full (also one indexed read the rest of the time).
 * - **Every `DEMO_CLEANUP_INTERVAL_MIN` (30), first after a minute:** the demo
 *   workspace cleanup, a handful of deletes that has no reason to run often.
 */

const QUICK_INTERVAL_MS = 5 * 60 * 1000;
const QUICK_FIRST_RUN_MS = 30_000;
const DEMO_FIRST_RUN_MS = 60_000;

const timers: NodeJS.Timeout[] = [];

/** Runs one job, logging instead of throwing: housekeeping must never take the process down. */
function guarded(name: string, job: () => Promise<unknown>): () => void {
  return () => {
    void job().catch((error: unknown) => {
      logger.error({ err: error, job: name }, '[housekeeping] job failed');
    });
  };
}

/**
 * The frequent pass: live meetings everybody has left, and the demo board's
 * sample tasks once nobody has touched the board for a while. Exported so the
 * sweep can be run by hand or from a test.
 */
export async function runQuickSweep(): Promise<void> {
  // The demo jobs run in order: moving the history forward (once a week)
  // re-dates the meetings the board's tasks are dated from.
  const demo = async () => {
    try {
      await refreshDemoHistory();
    } finally {
      await restoreDemoBoard();
    }
  };

  // Independent jobs: one failing must not stop the other.
  const results = await Promise.allSettled([endAbandonedMeetings(), demo()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason }, '[housekeeping] job failed');
    }
  }
}

export function startHousekeeping(): void {
  // Tests call the jobs directly; a background timer would mutate the
  // database under unrelated suites and keep vitest alive after they finish.
  if (isTest || timers.length > 0) return;

  const quick = guarded('quick sweep', runQuickSweep);
  const demo = guarded('demo cleanup', () => cleanupDemoData());

  timers.push(
    setTimeout(quick, QUICK_FIRST_RUN_MS),
    setInterval(quick, QUICK_INTERVAL_MS),
    setTimeout(demo, DEMO_FIRST_RUN_MS),
    setInterval(demo, env.DEMO_CLEANUP_INTERVAL_MIN * 60 * 1000),
  );
  // Do not hold the event loop open during shutdown.
  for (const timer of timers) timer.unref();

  logger.info(
    {
      liveMeetingIdleMin: env.LIVE_MEETING_IDLE_MIN,
      demoCleanupEveryMin: env.DEMO_CLEANUP_INTERVAL_MIN,
      demoTtlHours: env.DEMO_DATA_TTL_HOURS,
    },
    '[housekeeping] scheduled',
  );
}

export function stopHousekeeping(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.length = 0;
}
