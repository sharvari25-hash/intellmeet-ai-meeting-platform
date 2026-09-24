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
