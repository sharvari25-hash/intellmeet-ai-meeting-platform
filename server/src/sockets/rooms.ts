import { SOCKET_EVENTS, socketRooms } from '@intellmeet/shared';
import { recordParticipantLeave } from '../modules/meetings/meeting.service.js';
import {
  getParticipants,
  getRoomRecording,
  removeParticipant,
  setRoomRecording,
} from './presence.js';
import type { AppServer } from './socket.types.js';

/**
 * Who is really in a meeting room, as opposed to who the roster says is.
 *
 * The Redis roster is written by the join and leave handlers, and a process
 * that crashes or restarts never runs its leave handlers, so after a restart
 * the roster lists people whose sockets died with it. Socket.io's own room
 * membership cannot be wrong that way: a socket that is gone is gone.
 */

/**
 * The sockets connected to a meeting room right now, on every instance.
 *
 * With the Redis adapter `fetchSockets` asks the other instances too, and it
 * rejects if one of them does not answer. Callers treat a rejection as
 * "unknown", never as "empty".
 */
export async function connectedSocketIds(io: AppServer, meetingId: string): Promise<Set<string>> {
  const sockets = await io.in(socketRooms.meeting(meetingId)).fetchSockets();
  return new Set(sockets.map((socket) => socket.id));
}

/**
 * Moves somebody out of an older tab of the same browser, before their new
 * tab is given the roster.
 *
 * Two tabs of one browser in one room connect to each other, and each plays
 * the other's microphone back as an echo; nobody means to do it. The older
 * tab is taken out of the room and told why (`room:replaced`), and everyone
 * else drops its tile. Only the same `deviceId` counts: the same person on a
 * phone and a laptop stays in twice, which is legitimate.
 *
 * Attendance is not touched - the person has not left, they changed tabs.
 * Returns how many entries were replaced.
 */
export async function replaceSameDevice(
  io: AppServer,
  meetingId: string,
  newcomer: { socketId: string; userId: string; deviceId?: string },
): Promise<number> {
  if (!newcomer.deviceId) return 0;

  const roster = await getParticipants(meetingId);
  const older = roster.filter(
    (participant) =>
      participant.userId === newcomer.userId &&
      participant.deviceId === newcomer.deviceId &&
      participant.socketId !== newcomer.socketId,
  );
  if (older.length === 0) return 0;

  const room = socketRooms.meeting(meetingId);
  const recording = await getRoomRecording(meetingId);

  for (const tab of older) {
    await removeParticipant(meetingId, tab.socketId);
    // Out of the room on whichever instance holds it, so it stops receiving
    // the room's broadcasts; then told why, so it can say so.
    io.in(tab.socketId).socketsLeave(room);
    io.to(tab.socketId).emit(SOCKET_EVENTS.ROOM_REPLACED, { meetingId });
    io.to(room).emit(SOCKET_EVENTS.ROOM_USER_LEFT, {
      meetingId,
      socketId: tab.socketId,
      userId: tab.userId,
    });

    // The old tab stops its recorder when told; the indicator goes with it.
    if (recording?.socketId === tab.socketId) {
      await setRoomRecording(meetingId, null);
      io.to(room).emit(SOCKET_EVENTS.RECORDING_STATE, {
        meetingId,
        recording: false,
        byUserId: tab.userId,
      });
    }
  }

  return older.length;
}

/**
 * Drops roster entries whose socket is no longer connected, and tells the room.
 *
 * Run when somebody joins, before they are sent the roster, so a newcomer
 * never tries to open a peer connection to a socket that died in a restart
 * (it would sit on "Connecting…" until the watchdog gave up); and by the
 * housekeeping sweep for rooms that stay occupied. Everyone still in the room
 * is told each ghost left, which removes its frozen tile.
 *
 * Returns how many entries were removed.
 */
export async function pruneDisconnected(
  io: AppServer,
  meetingId: string,
  connected?: Set<string>,
): Promise<number> {
  const live = connected ?? (await connectedSocketIds(io, meetingId));
  const roster = await getParticipants(meetingId);
  const ghosts = roster.filter((participant) => !live.has(participant.socketId));
  if (ghosts.length === 0) return 0;

  const room = socketRooms.meeting(meetingId);
  const recording = await getRoomRecording(meetingId);

  for (const ghost of ghosts) {
    await removeParticipant(meetingId, ghost.socketId);
    io.to(room).emit(SOCKET_EVENTS.ROOM_USER_LEFT, {
      meetingId,
      socketId: ghost.socketId,
      userId: ghost.userId,
    });

    // A recording tab that died cannot still be recording.
    if (recording?.socketId === ghost.socketId) {
      await setRoomRecording(meetingId, null);
      io.to(room).emit(SOCKET_EVENTS.RECORDING_STATE, {
        meetingId,
        recording: false,
        byUserId: ghost.userId,
      });
    }
  }

  // Attendance: somebody whose every entry was a ghost has left. Somebody who
  // came back on a new socket (the usual case after a restart) is still here.
  const stillHere = new Set(
    roster.filter((participant) => live.has(participant.socketId)).map((p) => p.userId),
  );
  for (const userId of new Set(ghosts.map((ghost) => ghost.userId))) {
    if (!stillHere.has(userId)) await recordParticipantLeave(meetingId, userId);
  }

  return ghosts.length;
}
