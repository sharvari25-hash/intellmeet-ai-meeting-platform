import { z } from 'zod';
import { objectIdSchema } from './common.js';

/**
 * The Socket.io event contract, shared verbatim by both sides.
 *
 * Event names are constants rather than string literals at each call site: a
 * typo in `'room:joined'` vs `'room:user-joined'` is otherwise a silent
 * no-op that only shows up as "the other person's tile never appeared".
 *
 * Every inbound payload has a zod schema here too, because a socket message is
 * exactly as untrusted as an HTTP body - it simply bypasses the Express
 * middleware stack that would normally validate it.
 */
export const SOCKET_EVENTS = {
  // --- Room lifecycle ---
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_PARTICIPANTS: 'room:participants',
  ROOM_USER_JOINED: 'room:user-joined',
  ROOM_USER_LEFT: 'room:user-left',
  ROOM_HOST_MUTE: 'room:host-mute',
  ROOM_END: 'room:end',

  // --- WebRTC signalling (relayed verbatim, never inspected) ---
  RTC_OFFER: 'rtc:offer',
  RTC_ANSWER: 'rtc:answer',
  RTC_ICE_CANDIDATE: 'rtc:ice-candidate',

  // --- Media state ---
  MEDIA_TOGGLE: 'media:toggle',

  // --- Chat ---
  CHAT_SEND: 'chat:send',
  CHAT_MESSAGE: 'chat:message',
  CHAT_TYPING: 'chat:typing',
  CHAT_STOP_TYPING: 'chat:stop-typing',

  // --- Presence ---
  PRESENCE_ONLINE: 'presence:online',
  PRESENCE_OFFLINE: 'presence:offline',

  // --- Notifications ---
  NOTIFY_NEW: 'notify:new',

  // --- AI pipeline status (Phase 6) ---
  AI_STATUS: 'ai:status',

  // --- Kanban board (Phase 8) ---
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_MOVED: 'task:moved',

  // --- Transport-level ---
  ERROR: 'socket:error',
} as const;

export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];

/**
 * Room-name builders.
 *
 * Socket.io rooms are plain strings, so a consistent prefix is the only thing
 * stopping a meeting id from colliding with a team id. Both sides import these
 * rather than interpolating by hand.
 */
export const socketRooms = {
  meeting: (meetingId: string) => `meeting:${meetingId}`,
  team: (teamId: string) => `team:${teamId}`,
  /** Every socket belonging to one account, for notifications. */
  user: (userId: string) => `user:${userId}`,
  /** Kanban board room (Phase 8). */
  board: (boardId: string) => `board:${boardId}`,
} as const;

// --- Inbound payload schemas -----------------------------------------------

export const roomJoinSchema = z.object({
  meetingId: objectIdSchema,
});
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;

export const roomLeaveSchema = roomJoinSchema;

/**
 * WebRTC signalling is targeted at one peer's socket id.
 *
 * The SDP and ICE payloads are typed as `unknown` on purpose: the server
 * relays them without looking inside. Parsing session descriptions server-side
 * would add a dependency on WebRTC internals for no benefit, and would need
 * updating every time a browser changes its SDP.
 */
export const rtcSignalSchema = z.object({
  /** Socket id of the peer this is for. */
  target: z.string().min(1).max(64),
  meetingId: objectIdSchema,
  payload: z.unknown(),
});
export type RtcSignalPayload = z.infer<typeof rtcSignalSchema>;

/** What a relayed signal looks like when it arrives at the other peer. */
export const rtcSignalDeliverySchema = z.object({
  /** Socket id of the peer it came from; reply to this. */
  from: z.string(),
  fromUserId: objectIdSchema,
  meetingId: objectIdSchema,
  payload: z.unknown(),
});
export type RtcSignalDelivery = z.infer<typeof rtcSignalDeliverySchema>;

export const mediaStateSchema = z.object({
  audio: z.boolean(),
  video: z.boolean(),
  screen: z.boolean(),
});
export type MediaState = z.infer<typeof mediaStateSchema>;

export const mediaTogglePayloadSchema = z.object({
  meetingId: objectIdSchema,
  state: mediaStateSchema,
});

export const chatSendSchema = z.object({
  meetingId: objectIdSchema,
  text: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});
export type ChatSendPayload = z.infer<typeof chatSendSchema>;

export const chatTypingSchema = z.object({
  meetingId: objectIdSchema,
});

export const hostMuteSchema = z.object({
  meetingId: objectIdSchema,
  /** Omit to mute everyone but the host. */
  targetUserId: objectIdSchema.optional(),
});

export const roomEndSchema = z.object({
  meetingId: objectIdSchema,
});

// --- Outbound payload shapes -----------------------------------------------

/** One person in a room, as broadcast to the others. */
export const participantSchema = z.object({
  socketId: z.string(),
  userId: objectIdSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  isHost: z.boolean(),
  media: mediaStateSchema,
  joinedAt: z.string(),
});
export type Participant = z.infer<typeof participantSchema>;

export const roomParticipantsSchema = z.object({
  meetingId: objectIdSchema,
  /** The recipient's own socket id, so it can exclude itself from the mesh. */
  selfSocketId: z.string(),
  participants: z.array(participantSchema),
});
export type RoomParticipants = z.infer<typeof roomParticipantsSchema>;

export const userLeftSchema = z.object({
  meetingId: objectIdSchema,
  socketId: z.string(),
  userId: objectIdSchema,
});

export const typingSchema = z.object({
  meetingId: objectIdSchema,
  userId: objectIdSchema,
  name: z.string(),
});

export const presenceSchema = z.object({
  teamId: objectIdSchema,
  userId: objectIdSchema,
});

/** Error shape emitted on `socket:error`, mirroring the REST error contract. */
export const socketErrorSchema = z.object({
  event: z.string(),
  code: z.string(),
  message: z.string(),
});
export type SocketError = z.infer<typeof socketErrorSchema>;
