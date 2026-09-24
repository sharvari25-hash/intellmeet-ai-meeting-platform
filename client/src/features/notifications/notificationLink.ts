import type { Notification } from '@intellmeet/shared';

/**
 * Where selecting a notification should take you, from its payload.
 *
 * Null when there is nowhere better than the list itself. The payload is
 * loosely typed on purpose (see `notificationSchema`), so every field is
 * checked before it goes into a URL.
 */
export function notificationLink(notification: Notification): string | null {
  const { meetingId, roomCode, taskId, boardId } = notification.payload as {
    meetingId?: unknown;
    roomCode?: unknown;
    taskId?: unknown;
    boardId?: unknown;
  };

  if (notification.type === 'summary_ready' && typeof meetingId === 'string') {
    return `/app/meetings/${meetingId}`;
  }
  if (notification.type === 'meeting_started' && typeof roomCode === 'string') {
    return `/app/room/${roomCode}`;
  }
  // Assigned a task, or mentioned in a task's comments: that task, on its board.
  if (
    (notification.type === 'task_assigned' || notification.type === 'mention') &&
    typeof taskId === 'string' &&
    typeof boardId === 'string'
  ) {
    return `/app/tasks?board=${boardId}&task=${taskId}`;
  }
  // Mentioned in a meeting's chat: its chat log, which also links to the room
  // while the meeting is still live.
  if (notification.type === 'mention' && typeof meetingId === 'string') {
    return `/app/meetings/${meetingId}?tab=chat`;
  }
  return null;
}
