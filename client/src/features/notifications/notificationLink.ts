import type { Notification } from '@intellmeet/shared';

/**
 * Where selecting a notification should take you, from its payload.
 *
 * Null when there is nowhere better than the list itself. The payload is
 * loosely typed on purpose (see `notificationSchema`), so every field is
 * checked before it goes into a URL.
 */
export function notificationLink(notification: Notification): string | null {
  const { meetingId, roomCode } = notification.payload as {
    meetingId?: unknown;
    roomCode?: unknown;
  };

  if (notification.type === 'summary_ready' && typeof meetingId === 'string') {
    return `/app/meetings/${meetingId}`;
  }
  if (notification.type === 'meeting_started' && typeof roomCode === 'string') {
    return `/app/room/${roomCode}`;
  }
  return null;
}
