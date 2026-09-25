import { getRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Presence and room membership, held in Redis rather than in process memory.
 *
 * Both have to be shared state: Render can run more than one instance, and a
 * participant list that only knows about the sockets on *this* process would
 * show each person half the room. Redis is also where the Socket.io adapter
 * already lives, so it adds no new dependency.
 *
 * Every function here is fail-soft. Redis going down should degrade presence
 * to "we do not know who is online", not stop people joining meetings.
 */

const keys = {
  /** Set of userIds currently online for a team. */
  teamPresence: (teamId: string) => `presence:team:${teamId}`,
  /** Set of socket ids for one user, across every tab and device. */
  userSockets: (userId: string) => `presence:user:${userId}:sockets`,
  /** Hash of socketId -> participant JSON for one meeting room. */
  roomParticipants: (meetingId: string) => `room:${meetingId}:participants`,
  /** Who is recording the meeting right now, if anyone. */
  roomRecording: (meetingId: string) => `room:${meetingId}:recording`,
} as const;

/**
 * Rooms are expired rather than trusted to be cleaned up.
 *
 * A process killed mid-meeting never runs its disconnect handlers, so without
 * a TTL the hash would linger forever and the next visitor would see ghosts.
 */
const ROOM_TTL_SEC = 12 * 60 * 60;

export interface StoredParticipant {
  socketId: string;
  userId: string;
  name: string;
  avatarUrl: string | null;
  isHost: boolean;
  media: { audio: boolean; video: boolean; screen: boolean };
  joinedAt: string;
  /**
   * The browser the socket belongs to (see `roomJoinSchema`). Stored so a
   * second tab of the same browser can be recognised; never sent to anyone.
   */
  deviceId?: string;
}

// --- Team presence ---------------------------------------------------------

/**
 * Registers a socket for a user.
 *
 * Returns true only when this is the user's *first* socket, which is what
 * makes "came online" fire once rather than once per tab.
 */
export async function addUserSocket(userId: string, socketId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.sadd(keys.userSockets(userId), socketId);
    return (await redis.scard(keys.userSockets(userId))) === 1;
  } catch (error) {
    logger.warn({ err: error, userId }, '[presence] failed to record socket');
    return false;
  }
}

/** Returns true when the user's last socket has gone, i.e. they are now offline. */
export async function removeUserSocket(userId: string, socketId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.srem(keys.userSockets(userId), socketId);
    return (await redis.scard(keys.userSockets(userId))) === 0;
  } catch (error) {
    logger.warn({ err: error, userId }, '[presence] failed to clear socket');
    return false;
  }
}

export async function markOnlineForTeams(userId: string, teamIds: string[]): Promise<void> {
  try {
    const redis = getRedis();
    await Promise.all(teamIds.map((teamId) => redis.sadd(keys.teamPresence(teamId), userId)));
  } catch (error) {
    logger.warn({ err: error, userId }, '[presence] failed to mark online');
  }
}

export async function markOfflineForTeams(userId: string, teamIds: string[]): Promise<void> {
  try {
    const redis = getRedis();
    await Promise.all(teamIds.map((teamId) => redis.srem(keys.teamPresence(teamId), userId)));
  } catch (error) {
    logger.warn({ err: error, userId }, '[presence] failed to mark offline');
  }
}

export async function getOnlineTeamMembers(teamId: string): Promise<string[]> {
  try {
    return await getRedis().smembers(keys.teamPresence(teamId));
  } catch (error) {
    logger.warn({ err: error, teamId }, '[presence] failed to read team presence');
    return [];
  }
}

// --- Meeting room membership ----------------------------------------------

export async function addParticipant(
  meetingId: string,
  participant: StoredParticipant,
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.hset(
      keys.roomParticipants(meetingId),
      participant.socketId,
      JSON.stringify(participant),
    );
    // Refreshed on every join, so an active room never expires underneath itself.
    await redis.expire(keys.roomParticipants(meetingId), ROOM_TTL_SEC);
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to add participant');
  }
}

export async function removeParticipant(meetingId: string, socketId: string): Promise<void> {
  try {
    await getRedis().hdel(keys.roomParticipants(meetingId), socketId);
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to remove participant');
  }
}

export async function getParticipants(meetingId: string): Promise<StoredParticipant[]> {
  try {
    const entries = await getRedis().hgetall(keys.roomParticipants(meetingId));

    return Object.values(entries).flatMap((raw) => {
      try {
        return [JSON.parse(raw) as StoredParticipant];
      } catch {
        // A single corrupt entry must not break the whole participant list.
        return [];
      }
    });
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to read participants');
    return [];
  }
}

/** Updates one participant's media flags in place, if they are still present. */
export async function updateParticipantMedia(
  meetingId: string,
  socketId: string,
  media: StoredParticipant['media'],
): Promise<StoredParticipant | null> {
  try {
    const redis = getRedis();
    const raw = await redis.hget(keys.roomParticipants(meetingId), socketId);
    if (!raw) return null;

    const participant = { ...(JSON.parse(raw) as StoredParticipant), media };
    await redis.hset(keys.roomParticipants(meetingId), socketId, JSON.stringify(participant));

    return participant;
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to update media state');
    return null;
  }
}

/** Removes every trace of a room. Called when the host ends the meeting. */
export async function clearRoom(meetingId: string): Promise<void> {
  try {
    await getRedis().del(keys.roomParticipants(meetingId), keys.roomRecording(meetingId));
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to clear room');
  }
}

// --- Recording indicator -----------------------------------------------------

export interface RoomRecording {
  socketId: string;
  userId: string;
}

/**
 * Marks the room as being recorded by one socket, or clears it with null.
 *
 * Kept in Redis alongside the roster so a participant who joins mid-recording
 * - on any instance - is told straight away. Remembering *which* socket is
 * recording lets the flag be cleared when that tab closes without saying so.
 */
export async function setRoomRecording(
  meetingId: string,
  recording: RoomRecording | null,
): Promise<void> {
  try {
    const redis = getRedis();
    if (recording) {
      await redis.set(keys.roomRecording(meetingId), JSON.stringify(recording), 'EX', ROOM_TTL_SEC);
    } else {
      await redis.del(keys.roomRecording(meetingId));
    }
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to update recording state');
  }
}

export async function getRoomRecording(meetingId: string): Promise<RoomRecording | null> {
  try {
    const raw = await getRedis().get(keys.roomRecording(meetingId));
    return raw ? (JSON.parse(raw) as RoomRecording) : null;
  } catch (error) {
    logger.warn({ err: error, meetingId }, '[presence] failed to read recording state');
    return null;
  }
}
