import { SOCKET_EVENTS, socketRooms } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { getIo } from '../../sockets/index.js';
import { invalidateTeamAnalytics } from '../analytics/analytics.cache.js';
import { clearRoom } from '../../sockets/presence.js';
import { connectedSocketIds, pruneDisconnected } from '../../sockets/rooms.js';
import type { AppServer } from '../../sockets/socket.types.js';
import { Meeting, type MeetingDocument } from './meeting.model.js';
import { invalidateMeeting } from './meeting.service.js';

export interface MeetingSweepResult {
  /** Live meetings looked at. */
  checked: number;
  /** Ended because nobody had been in them for the idle limit. */
  ended: number;
  /** Roster entries removed from occupied rooms because their socket was gone. */
  pruned: number;
}

/**
 * Ends live meetings that everybody has left.
 *
 * Only the host's "End for all" ends a meeting, and plenty of meetings never
 * get one: the last person closes the tab, a laptop sleeps, the server
 * restarts. Such a meeting used to show as Live forever - on the dashboard,
 * in the history, and to anyone opening its link - and nothing ever cleaned it
 * up if its host was a seeded account the demo sweep leaves alone.
 *
 * The rule: a live meeting with **nobody connected** whose `lastActiveAt` (the
 * last moment somebody was known to be in it) is older than
 * `LIVE_MEETING_IDLE_MIN` is ended. Two sources of truth, deliberately:
 *
 * - **Who is connected** comes from Socket.io's room membership across every
 *   instance, never from the Redis roster, which lists ghosts after a
 *   restart. If an instance does not answer, the meeting is left alone:
 *   "unknown" must never be read as "empty".
 * - **How long it has been empty** comes from `lastActiveAt`, stamped on
 *   every join and leave and refreshed here while the room is occupied. After
 *   a restart the sockets are gone but that stamp is at most one sweep old,
 *   so a call that was running a minute ago is not ended while its people
 *   reconnect; one abandoned hours ago is ended at the first sweep.
 *
 * `endedAt` is the moment the room was last known to be occupied, so the
 * meeting's duration is how long it actually ran, not how long it went
 * unnoticed. The update is conditional on the meeting still being live and
 * `lastActiveAt` unchanged, so a join that lands between the check and the
 * write keeps the meeting open, and several instances sweeping at once end it
 * once.
 */
export async function endAbandonedMeetings(
  options: { now?: Date; idleMinutes?: number; io?: AppServer } = {},
): Promise<MeetingSweepResult> {
  const io = options.io ?? getIo();
  const result: MeetingSweepResult = { checked: 0, ended: 0, pruned: 0 };

  // Without a socket server nobody's presence can be known, and ending a
  // meeting on a guess is worse than leaving it live a little longer.
  if (!io) return result;

  const now = options.now ?? new Date();
  const idleMinutes = options.idleMinutes ?? env.LIVE_MEETING_IDLE_MIN;
  const cutoff = new Date(now.getTime() - idleMinutes * 60 * 1000);

  const live = await Meeting.find({ status: 'live' }).select(
    '_id teamId roomCode title startedAt createdAt lastActiveAt',
  );

  for (const meeting of live) {
    result.checked += 1;
    const meetingId = meeting._id.toString();

    let connected: Set<string>;
    try {
      connected = await connectedSocketIds(io, meetingId);
    } catch (error) {
      logger.warn({ err: error, meetingId }, '[meetings] could not tell who is in a live meeting');
      continue;
    }

    if (connected.size > 0) {
      // Occupied: keep the stamp fresh, so a restart right now would not make
      // it look abandoned, and drop any ghosts left by the last restart.
      await Meeting.updateOne({ _id: meeting._id, status: 'live' }, { lastActiveAt: now });
      result.pruned += await pruneDisconnected(io, meetingId, connected);
      continue;
    }

    const lastSeen = meeting.lastActiveAt ?? meeting.startedAt ?? meeting.createdAt;
    if (lastSeen.getTime() > cutoff.getTime()) continue;

    if (await endAbandoned(io, meeting, lastSeen)) result.ended += 1;
  }

  if (result.ended > 0 || result.pruned > 0) {
    logger.info({ ...result, idleMinutes }, '[meetings] swept live meetings');
  }
  return result;
}

async function endAbandoned(
  io: AppServer,
  meeting: MeetingDocument,
  endedAt: Date,
): Promise<boolean> {
  const update = await Meeting.updateOne(
    { _id: meeting._id, status: 'live', lastActiveAt: meeting.lastActiveAt ?? null },
    {
      $set: {
        status: 'ended',
        endedAt,
        // Anyone the socket layer never saw leave left when the room did.
        'participants.$[open].leftAt': endedAt,
      },
    },
    { arrayFilters: [{ 'open.leftAt': null }] },
  );
  if (update.modifiedCount === 0) return false;

  const meetingId = meeting._id.toString();
  await invalidateMeeting(meeting);
  await invalidateTeamAnalytics([meeting.teamId]);
  await clearRoom(meetingId);

  // Nobody is connected, but a socket on an instance that did not answer, or
  // a lobby about to join, is told the same thing "End for all" would say.
  io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.ROOM_END, { meetingId });
  io.socketsLeave(socketRooms.meeting(meetingId));

  logger.info(
    { meetingId, title: meeting.title, lastSeen: endedAt },
    '[meetings] ended a meeting everybody had left',
  );
  return true;
}
