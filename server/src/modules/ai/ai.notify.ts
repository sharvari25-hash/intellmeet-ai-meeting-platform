import { SOCKET_EVENTS, socketRooms, type AiStatus } from '@intellmeet/shared';
import { logger } from '../../lib/logger.js';
import { getIo } from '../../sockets/index.js';
import { safeCreateNotifications } from '../notifications/notification.service.js';

interface MeetingRef {
  id: string;
  teamId: string;
  title: string;
}

/**
 * Broadcasts a pipeline step to the meeting's team.
 *
 * The team room rather than the meeting room: by the time a summary is ready
 * everyone has usually left the call, and any team member may have the
 * meeting page open. Every socket joins its teams' rooms on connect, so this
 * reaches exactly the people allowed to see the meeting.
 */
export function publishAiStatus(meeting: MeetingRef, status: AiStatus, error: string | null): void {
  getIo()
    ?.to(socketRooms.team(meeting.teamId))
    .emit(SOCKET_EVENTS.AI_STATUS, { meetingId: meeting.id, status, error });
}

/**
 * Tells the people who were in the meeting that its summary is ready.
 *
 * Persisted first, pushed second - someone offline finds it in the bell later.
 * Never throws: the summary genuinely exists, and a failed notification must
 * not turn a finished job into a failed one.
 */
export async function notifySummaryReady(meeting: MeetingRef, userIds: string[]): Promise<void> {
  try {
    const created = await safeCreateNotifications(
      userIds.map((userId) => ({
        userId,
        type: 'summary_ready' as const,
        title: 'Meeting summary ready',
        body: `The summary and action items for "${meeting.title}" are ready`,
        payload: { meetingId: meeting.id, teamId: meeting.teamId },
      })),
    );

    const io = getIo();
    if (!io) return;

    for (const { userId, notification } of created) {
      io.to(socketRooms.user(userId)).emit(SOCKET_EVENTS.NOTIFY_NEW, notification);
    }
  } catch (error) {
    logger.error({ err: error, meetingId: meeting.id }, '[ai] failed to notify summary ready');
  }
}
