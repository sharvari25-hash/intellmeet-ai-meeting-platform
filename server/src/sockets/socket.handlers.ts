import {
  SOCKET_EVENTS,
  chatSendSchema,
  chatTypingSchema,
  hostMuteSchema,
  mediaTogglePayloadSchema,
  recordingStateSchema,
  roomEndSchema,
  roomJoinSchema,
  roomLeaveSchema,
  rtcSignalSchema,
  socketRooms,
  type Participant,
} from '@intellmeet/shared';
import type { ZodType } from 'zod';
import { AppError, isAppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { createMessage } from '../modules/chat/chat.service.js';
import {
  endMeeting,
  getMeetingForMember,
  recordParticipantJoin,
  recordParticipantLeave,
} from '../modules/meetings/meeting.service.js';
import {
  addParticipant,
  clearRoom,
  getParticipants,
  getRoomRecording,
  removeParticipant,
  setRoomRecording,
  updateParticipantMedia,
  type StoredParticipant,
} from './presence.js';
import type { AppServer, AppSocket } from './socket.types.js';

/**
 * Per-socket chat throttle.
 *
 * Socket events bypass the Express pipeline entirely, so `express-rate-limit`
 * never sees them. A sliding window kept on the socket itself is enough: a
 * socket lives on exactly one process, so there is nothing to share, and when
 * it disconnects the state disappears with it.
 */
const CHAT_WINDOW_MS = 10_000;
const CHAT_MAX_PER_WINDOW = 15;

const chatTimestamps = new WeakMap<AppSocket, number[]>();

function chatAllowed(socket: AppSocket): boolean {
  const now = Date.now();
  const recent = (chatTimestamps.get(socket) ?? []).filter((at) => now - at < CHAT_WINDOW_MS);

  if (recent.length >= CHAT_MAX_PER_WINDOW) {
    chatTimestamps.set(socket, recent);
    return false;
  }

  recent.push(now);
  chatTimestamps.set(socket, recent);
  return true;
}

/** Reports a failure to the one socket that caused it, mirroring the REST error shape. */
function emitError(socket: AppSocket, event: string, error: unknown): void {
  const appError = isAppError(error) ? error : AppError.internal();

  socket.emit(SOCKET_EVENTS.ERROR, {
    event,
    code: appError.code,
    message: appError.isClientSafe ? appError.message : 'Something went wrong',
  });

  if (!appError.isClientSafe) {
    logger.error({ err: error, event, userId: socket.data.user.id }, '[socket] handler failed');
  }
}

/**
 * Wraps a handler with payload validation and error reporting.
 *
 * A socket payload is exactly as untrusted as an HTTP body - it simply skips
 * the middleware stack that would normally validate it. Without this wrapper
 * an unhandled rejection inside a handler would also take down the process,
 * because Socket.io does not await listener promises.
 */
function on<T>(
  socket: AppSocket,
  event: string,
  schema: ZodType<T>,
  handler: (payload: T) => Promise<void> | void,
): void {
  socket.on(event, (raw: unknown) => {
    const parsed = schema.safeParse(raw);

    if (!parsed.success) {
      emitError(
        socket,
        event,
        AppError.validation(
          parsed.error.issues.map((issue) => ({
            path: issue.path.map(String).join('.') || '(root)',
            message: issue.message,
          })),
        ),
      );
      return;
    }

    void (async () => {
      try {
        await handler(parsed.data);
      } catch (error) {
        emitError(socket, event, error);
      }
    })();
  });
}

const toParticipant = (stored: StoredParticipant): Participant => stored;

/** Which meetings this socket is currently in, so disconnect can clean up. */
const socketRoomsJoined = new WeakMap<AppSocket, Set<string>>();

function trackJoin(socket: AppSocket, meetingId: string): void {
  const set = socketRoomsJoined.get(socket) ?? new Set<string>();
  set.add(meetingId);
  socketRoomsJoined.set(socket, set);
}

async function leaveRoom(io: AppServer, socket: AppSocket, meetingId: string): Promise<void> {
  const { user } = socket.data;

  await removeParticipant(meetingId, socket.id);
  await recordParticipantLeave(meetingId, user.id);

  socket.leave(socketRooms.meeting(meetingId));
  socketRoomsJoined.get(socket)?.delete(meetingId);

  io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.ROOM_USER_LEFT, {
    meetingId,
    socketId: socket.id,
    userId: user.id,
  });

  // The recorder's tab closing ends the recording, so the indicator must not
  // outlive it and tell everyone they are still being recorded.
  const recording = await getRoomRecording(meetingId);
  if (recording?.socketId === socket.id) {
    await setRoomRecording(meetingId, null);
    io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.RECORDING_STATE, {
      meetingId,
      recording: false,
      byUserId: user.id,
    });
  }
}

export function registerHandlers(io: AppServer, socket: AppSocket): void {
  const { user } = socket.data;

  // --- Room lifecycle ------------------------------------------------------

  on(socket, SOCKET_EVENTS.ROOM_JOIN, roomJoinSchema, async ({ meetingId }) => {
    // Authorisation is re-checked here, not inherited from the handshake: the
    // handshake only proves who you are, never which meetings you may enter.
    const meeting = await getMeetingForMember(meetingId, user.id);

    if (meeting.status === 'ended') {
      throw AppError.conflict('That meeting has already ended');
    }

    const participant: StoredParticipant = {
      socketId: socket.id,
      userId: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isHost: meeting.hostId.toString() === user.id,
      media: { audio: true, video: true, screen: false },
      joinedAt: new Date().toISOString(),
    };

    await socket.join(socketRooms.meeting(meetingId));
    await addParticipant(meetingId, participant);
    await recordParticipantJoin(meetingId, user.id);
    trackJoin(socket, meetingId);

    // Tell the newcomer who is already here, so it can open a peer connection
    // to each of them. `selfSocketId` lets it exclude itself from the mesh.
    const [participants, recording] = await Promise.all([
      getParticipants(meetingId),
      getRoomRecording(meetingId),
    ]);
    socket.emit(SOCKET_EVENTS.ROOM_PARTICIPANTS, {
      meetingId,
      selfSocketId: socket.id,
      participants: participants.map(toParticipant),
      recording: recording !== null,
    });

    // ...and tell everyone else that someone arrived. Broadcast excludes the
    // sender, which is what stops a peer trying to negotiate with itself.
    socket.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.ROOM_USER_JOINED, {
      meetingId,
      participant: toParticipant(participant),
    });
  });

  on(socket, SOCKET_EVENTS.ROOM_LEAVE, roomLeaveSchema, async ({ meetingId }) => {
    await leaveRoom(io, socket, meetingId);
  });

  // --- WebRTC signalling ---------------------------------------------------
  //
  // The server relays these verbatim and never inspects the SDP or candidates.
  // That is the whole point of a mesh: media goes peer to peer, and the only
  // thing the backend contributes is introducing the peers to each other.

  for (const event of [
    SOCKET_EVENTS.RTC_OFFER,
    SOCKET_EVENTS.RTC_ANSWER,
    SOCKET_EVENTS.RTC_ICE_CANDIDATE,
  ]) {
    on(socket, event, rtcSignalSchema, ({ target, meetingId, payload }) => {
      // Only relay into rooms this socket has actually joined, so a signal
      // cannot be injected into a meeting the sender is not part of.
      if (!socketRoomsJoined.get(socket)?.has(meetingId)) {
        throw AppError.forbidden('You are not in that meeting');
      }

      io.to(target).emit(event, {
        from: socket.id,
        fromUserId: user.id,
        meetingId,
        payload,
      });
    });
  }

  on(socket, SOCKET_EVENTS.MEDIA_TOGGLE, mediaTogglePayloadSchema, async ({ meetingId, state }) => {
    const updated = await updateParticipantMedia(meetingId, socket.id, state);
    if (!updated) return;

    socket.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.MEDIA_TOGGLE, {
      meetingId,
      socketId: socket.id,
      userId: user.id,
      state,
    });
  });

  // --- Recording indicator -------------------------------------------------

  on(
    socket,
    SOCKET_EVENTS.RECORDING_STATE,
    recordingStateSchema,
    async ({ meetingId, recording }) => {
      if (!socketRoomsJoined.get(socket)?.has(meetingId)) {
        throw AppError.forbidden('You are not in that meeting');
      }

      // Only the host records (the plan's rule, and the one person whose
      // browser holds everyone's audio with their knowledge).
      const meeting = await getMeetingForMember(meetingId, user.id);
      if (meeting.hostId.toString() !== user.id) {
        throw AppError.forbidden('Only the host can record the meeting');
      }

      await setRoomRecording(
        meetingId,
        recording ? { socketId: socket.id, userId: user.id } : null,
      );

      // Everyone, the host included: each browser renders the indicator from the
      // same broadcast, so nobody can be shown a state the others are not.
      io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.RECORDING_STATE, {
        meetingId,
        recording,
        byUserId: user.id,
      });
    },
  );

  // --- Chat ----------------------------------------------------------------

  on(socket, SOCKET_EVENTS.CHAT_SEND, chatSendSchema, async ({ meetingId, text }) => {
    if (!chatAllowed(socket)) {
      throw AppError.tooManyRequests('You are sending messages too quickly');
    }

    await getMeetingForMember(meetingId, user.id);

    // Persist before broadcasting: a message everybody saw but that vanishes
    // on refresh is worse than one that arrives a few milliseconds later.
    const message = await createMessage(meetingId, user.id, text);

    io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.CHAT_MESSAGE, message);
  });

  on(socket, SOCKET_EVENTS.CHAT_TYPING, chatTypingSchema, ({ meetingId }) => {
    // Not persisted and not validated against membership: a typing indicator
    // is ephemeral and only reaches a room this socket has already joined.
    socket.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.CHAT_TYPING, {
      meetingId,
      userId: user.id,
      name: user.name,
    });
  });

  on(socket, SOCKET_EVENTS.CHAT_STOP_TYPING, chatTypingSchema, ({ meetingId }) => {
    socket.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.CHAT_STOP_TYPING, {
      meetingId,
      userId: user.id,
      name: user.name,
    });
  });

  // --- Host controls -------------------------------------------------------

  on(socket, SOCKET_EVENTS.ROOM_HOST_MUTE, hostMuteSchema, async ({ meetingId, targetUserId }) => {
    const meeting = await getMeetingForMember(meetingId, user.id);

    if (meeting.hostId.toString() !== user.id) {
      throw AppError.forbidden('Only the host can mute participants');
    }

    // A request, not an enforcement: the server never touches media, so the
    // participant's own client is what actually stops the track. The UI shows
    // the resulting state, which keeps the honest "you were muted" signal.
    io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.ROOM_HOST_MUTE, {
      meetingId,
      targetUserId: targetUserId ?? null,
      byUserId: user.id,
    });
  });

  on(socket, SOCKET_EVENTS.ROOM_END, roomEndSchema, async ({ meetingId }) => {
    // `endMeeting` enforces host-only itself.
    await endMeeting(meetingId, user.id);

    io.to(socketRooms.meeting(meetingId)).emit(SOCKET_EVENTS.ROOM_END, { meetingId });
    await clearRoom(meetingId);

    // Socket.io leaves the room for us once every socket disconnects, but the
    // clients stay connected - they just navigate away - so empty it here.
    io.socketsLeave(socketRooms.meeting(meetingId));
  });

  // --- Disconnect ----------------------------------------------------------

  socket.on('disconnect', () => {
    void (async () => {
      const joined = socketRoomsJoined.get(socket);
      if (!joined) return;

      // A closed tab never sends `room:leave`, so the same cleanup runs here.
      for (const meetingId of joined) {
        try {
          await leaveRoom(io, socket, meetingId);
        } catch (error) {
          logger.warn({ err: error, meetingId }, '[socket] cleanup on disconnect failed');
        }
      }
    })();
  });
}
