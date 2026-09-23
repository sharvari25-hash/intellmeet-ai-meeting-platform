import { env, isTest } from '../../config/env.js';
import { cacheDel, cacheKeys } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';
import { Message } from '../chat/message.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';

export interface DemoCleanupResult {
  meetings: number;
  messages: number;
  teams: number;
  notifications: number;
}

const EMPTY: DemoCleanupResult = { meetings: 0, messages: 0, teams: 0, notifications: 0 };

/**
 * Removes stale data created through the shared demo account.
 *
 * Every reviewer signs into the *same* account, so every team and meeting one
 * of them creates is visible to all the others. Left alone the workspace fills
 * with "test", "asdf" and a dozen abandoned meetings, and the next reviewer's
 * first impression is somebody else's debris.
 *
 * Two things are never touched:
 *
 * - **The seeded team**, matched by slug. It is the thing the demo is *for*.
 * - **Anything newer than the cutoff.** This is the whole reason the job is
 *   age-based rather than a reset button: a reviewer mid-demo must never have
 *   the room deleted underneath them by a job, or by another reviewer holding
 *   the same session.
 */
export async function cleanupDemoData(
  options: { olderThanHours?: number } = {},
): Promise<DemoCleanupResult> {
  const hours = options.olderThanHours ?? env.DEMO_DATA_TTL_HOURS;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  // The demo account is the one the seed marks; there is no need to know its
  // id up front, and on a fresh database there may be none at all.
  const demoUsers = await User.find({ authProvider: 'demo' }).select('_id');
  if (demoUsers.length === 0) return { ...EMPTY };

  const demoIds = demoUsers.map((user) => user._id);

  // --- Teams the demo account created, other than the seeded one -----------

  const staleTeams = await Team.find({
    ownerId: { $in: demoIds },
    slug: { $ne: DEMO_TEAM_SLUG },
    createdAt: { $lt: cutoff },
  }).select('_id');

  const staleTeamIds = staleTeams.map((team) => team._id);

  // --- Meetings: stale ones the demo account hosted, plus every meeting in
  //     a team that is about to disappear regardless of its own age ---------

  const meetingFilter = {
    $or: [
      { hostId: { $in: demoIds }, createdAt: { $lt: cutoff } },
      ...(staleTeamIds.length > 0 ? [{ teamId: { $in: staleTeamIds } }] : []),
    ],
  };

  const staleMeetings = await Meeting.find(meetingFilter).select('_id roomCode');
  const meetingIds = staleMeetings.map((meeting) => meeting._id);

  // Ordered deliberately: children before parents, so a crash halfway through
  // leaves orphaned parents (harmless, retried next run) rather than orphaned
  // children pointing at ids that no longer resolve.
  const messages =
    meetingIds.length > 0
      ? (await Message.deleteMany({ meetingId: { $in: meetingIds } })).deletedCount
      : 0;

  const meetings =
    meetingIds.length > 0
      ? (await Meeting.deleteMany({ _id: { $in: meetingIds } })).deletedCount
      : 0;

  const teams =
    staleTeamIds.length > 0
      ? (await Team.deleteMany({ _id: { $in: staleTeamIds } })).deletedCount
      : 0;

  const notifications = (
    await Notification.deleteMany({ userId: { $in: demoIds }, createdAt: { $lt: cutoff } })
  ).deletedCount;

  // A deleted meeting whose view is still warm in Redis would keep resolving
  // by room code until the TTL expired.
  if (staleMeetings.length > 0) {
    await cacheDel(
      ...staleMeetings.flatMap((meeting) => [
        cacheKeys.meeting(meeting._id.toString()),
        cacheKeys.meetingByCode(meeting.roomCode),
      ]),
    );
  }

  const result = { meetings, messages, teams, notifications };

  if (meetings + messages + teams + notifications > 0) {
    logger.info({ ...result, cutoff, hours }, '[demo] cleaned up stale demo data');
  }

  return result;
}

let timer: NodeJS.Timeout | undefined;

/**
 * Runs the cleanup periodically for as long as the process lives.
 *
 * An interval in-process rather than a platform cron: Render's free tier has
 * no scheduler, and this is a handful of indexed deletes - not work that
 * deserves its own dyno. If several instances ever run it at once the deletes
 * are idempotent, so the duplicate work is wasted rather than wrong.
 *
 * The first pass is delayed rather than immediate so it never competes with
 * the traffic of a cold start.
 */
export function startDemoCleanup(): void {
  // Tests call `cleanupDemoData` directly; a background timer would mutate the
  // database under unrelated suites and leak a handle that keeps vitest alive.
  if (isTest || timer) return;

  const intervalMs = env.DEMO_CLEANUP_INTERVAL_MIN * 60 * 1000;

  const run = (): void => {
    void cleanupDemoData().catch((error: unknown) => {
      // Housekeeping must never take the process down.
      logger.error({ err: error }, '[demo] cleanup failed');
    });
  };

  setTimeout(run, 60_000).unref();

  timer = setInterval(run, intervalMs);
  // Do not hold the event loop open during shutdown.
  timer.unref();

  logger.info(
    { everyMinutes: env.DEMO_CLEANUP_INTERVAL_MIN, ttlHours: env.DEMO_DATA_TTL_HOURS },
    '[demo] cleanup scheduled',
  );
}

export function stopDemoCleanup(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
