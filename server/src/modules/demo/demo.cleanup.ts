import type { Types } from 'mongoose';
import { env, isTest } from '../../config/env.js';
import { cacheDel, cacheKeys } from '../../lib/cache.js';
import { logger } from '../../lib/logger.js';
import { Message } from '../chat/message.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { deleteMeetingArtifacts } from '../meetings/meeting.service.js';
import { Notification } from '../notifications/notification.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';

export interface DemoCleanupResult {
  guests: number;
  meetings: number;
  messages: number;
  teams: number;
  notifications: number;
}

const EMPTY: DemoCleanupResult = {
  guests: 0,
  meetings: 0,
  messages: 0,
  teams: 0,
  notifications: 0,
};

function add(a: DemoCleanupResult, b: DemoCleanupResult): DemoCleanupResult {
  return {
    guests: a.guests + b.guests,
    meetings: a.meetings + b.meetings,
    messages: a.messages + b.messages,
    teams: a.teams + b.teams,
    notifications: a.notifications + b.notifications,
  };
}

/**
 * Deletes the given teams and every meeting matching the filter or held in
 * one of those teams, with everything that hangs off them.
 *
 * Ordered deliberately: children before parents, so a crash halfway through
 * leaves orphaned parents (harmless, retried next run) rather than orphaned
 * children pointing at ids that no longer resolve. Seeded meetings are never
 * matched, whatever the filter says.
 */
async function purge(
  meetingFilter: Record<string, unknown> | null,
  teamIds: Types.ObjectId[],
): Promise<Pick<DemoCleanupResult, 'meetings' | 'messages' | 'teams'>> {
  const conditions = [
    ...(meetingFilter ? [meetingFilter] : []),
    ...(teamIds.length > 0 ? [{ teamId: { $in: teamIds } }] : []),
  ];

  const meetings =
    conditions.length > 0
      ? await Meeting.find({ seeded: { $ne: true }, $or: conditions }).select(
          '_id roomCode recording',
        )
      : [];
  const meetingIds = meetings.map((meeting) => meeting._id);

  // Counted here, before the shared cascade below deletes them too, only so
  // the result can report how many there were.
  const messages =
    meetingIds.length > 0
      ? (await Message.deleteMany({ meetingId: { $in: meetingIds } })).deletedCount
      : 0;

  // Transcripts, insights, notifications and recording files.
  await deleteMeetingArtifacts(meetings);

  const meetingCount =
    meetingIds.length > 0
      ? (await Meeting.deleteMany({ _id: { $in: meetingIds } })).deletedCount
      : 0;

  const teams =
    teamIds.length > 0 ? (await Team.deleteMany({ _id: { $in: teamIds } })).deletedCount : 0;

  // A deleted meeting whose view is still warm in Redis would keep resolving
  // by room code until the TTL expired.
  if (meetings.length > 0) {
    await cacheDel(
      ...meetings.flatMap((meeting) => [
        cacheKeys.meeting(meeting._id.toString()),
        cacheKeys.meetingByCode(meeting.roomCode),
      ]),
    );
  }

  return { meetings: meetingCount, messages, teams };
}

/**
 * Removes guest accounts and everything that only they could manage.
 *
 * A guest has no password, so once its session is over nobody can ever act
 * as it again: the meetings it hosted could not be ended, edited or deleted,
 * and the teams it owned would have no admin. Those go with it, **whatever
 * their age**. What it merely took part in stays - a meeting somebody else
 * hosted keeps its history, and a message the guest sent keeps its place in
 * that conversation (shown as "Unknown user").
 *
 * Used by the periodic sweep for inactive guests, and by `DELETE
 * /api/auth/demo` when a guest ends their own session. Only ever deletes
 * accounts whose provider is `guest`, whatever ids it is handed.
 */
export async function removeGuests(guestIds: Types.ObjectId[]): Promise<DemoCleanupResult> {
  if (guestIds.length === 0) return { ...EMPTY };

  const ownedTeams = await Team.find({
    ownerId: { $in: guestIds },
    // A guest cannot own the seeded team, but the one thing this must never
    // delete is worth saying explicitly.
    slug: { $ne: DEMO_TEAM_SLUG },
  }).select('_id');

  const purged = await purge(
    { hostId: { $in: guestIds } },
    ownedTeams.map((team) => team._id),
  );

  // Out of every team they joined, above all the seeded one, whose member
  // list would otherwise grow by one dead entry per demo sign-in.
  await Team.updateMany(
    { 'members.userId': { $in: guestIds } },
    { $pull: { members: { userId: { $in: guestIds } } } },
  );

  const notifications = (await Notification.deleteMany({ userId: { $in: guestIds } })).deletedCount;

  const guests = (await User.deleteMany({ _id: { $in: guestIds }, authProvider: 'guest' }))
    .deletedCount;

  return { guests, notifications, ...purged };
}

/**
 * Guests that have been idle for longer than the cutoff.
 *
 * "Idle" rather than "old": a reviewer who is still clicking around after
 * the TTL must not be deleted mid-session. Every sign-in and every token
 * refresh pushes a refresh token stamped with its creation time, and an
 * active tab refreshes at least every 15 minutes, so a guest with no token
 * newer than the cutoff has done nothing since then. (`$not` + `$gte` on an
 * array matches when *no* element is that recent, including an empty list
 * after sign-out.)
 */
async function findIdleGuests(cutoff: Date): Promise<Types.ObjectId[]> {
  const idle = await User.find({
    authProvider: 'guest',
    createdAt: { $lt: cutoff },
    'refreshTokens.createdAt': { $not: { $gte: cutoff } },
  }).select('_id');
  return idle.map((user) => user._id);
}

/**
 * Removes stale data from the demo workspace.
 *
 * Every reviewer lands in the same demo team, so every team and meeting one
 * of them creates is visible to all the others. Left alone the workspace fills
 * with "test", "asdf" and a dozen abandoned meetings, and the next reviewer's
 * first impression is somebody else's debris. Each demo sign-in is also a
 * guest account, and those would accumulate in the team's member list.
 *
 * Two passes:
 *
 * 1. **Idle guests** are removed with everything only they could manage (see
 *    `removeGuests`).
 * 2. **Stale content** that demo accounts (the seeded persona and guests
 *    still in use) created more than the TTL ago: throwaway teams, their
 *    meetings, and notifications.
 *
 * Three things are never touched:
 *
 * - **The seeded team**, matched by slug. It is the thing the demo is *for*.
 * - **Seeded meetings** (`seeded: true`), the sample history with transcripts
 *   and summaries that the landing page promises is already there.
 * - **Anything recent, and any guest still active.** This is the whole reason
 *   the job is age-based rather than a reset button: a reviewer mid-demo must
 *   never have the room deleted underneath them.
 */
export async function cleanupDemoData(
  options: { olderThanHours?: number } = {},
): Promise<DemoCleanupResult> {
  const hours = options.olderThanHours ?? env.DEMO_DATA_TTL_HOURS;
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const guestPass = await removeGuests(await findIdleGuests(cutoff));

  // The seeded persona is marked by the seed, and guests by the demo login;
  // on a fresh database there may be neither.
  const demoUsers = await User.find({ authProvider: { $in: ['demo', 'guest'] } }).select('_id');
  const demoIds = demoUsers.map((user) => user._id);

  let result = guestPass;

  if (demoIds.length > 0) {
    const staleTeams = await Team.find({
      ownerId: { $in: demoIds },
      slug: { $ne: DEMO_TEAM_SLUG },
      createdAt: { $lt: cutoff },
    }).select('_id');

    // Stale meetings a demo account hosted, plus every meeting in a team that
    // is about to disappear regardless of its own age. Seeded past meetings
    // are hosted by the demo persona and are, by design, older than any
    // cutoff; `purge` never matches them.
    const purged = await purge(
      { hostId: { $in: demoIds }, createdAt: { $lt: cutoff } },
      staleTeams.map((team) => team._id),
    );

    const notifications = (
      await Notification.deleteMany({ userId: { $in: demoIds }, createdAt: { $lt: cutoff } })
    ).deletedCount;

    result = add(result, { ...EMPTY, ...purged, notifications });
  }

  if (Object.values(result).some((count) => count > 0)) {
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
