import { SOCKET_EVENTS, socketRooms, type Notification } from '@intellmeet/shared';
import type { AppServer } from '../../sockets/socket.types.js';

/**
 * Pushes notifications that have already been saved to each recipient's
 * sockets.
 *
 * The server is passed in rather than imported: the socket handlers deliver
 * chat mentions with the server they already hold, and importing the socket
 * layer here would make it import itself. With no server (tests, scripts) the
 * rows are still in the bell on the next page load; only the live push is
 * skipped.
 */
export function deliverNotifications(
  io: AppServer | undefined,
  created: { userId: string; notification: Notification }[],
): void {
  if (!io) return;
  for (const { userId, notification } of created) {
    // The account's private room, so every tab the person has open lights up.
    io.to(socketRooms.user(userId)).emit(SOCKET_EVENTS.NOTIFY_NEW, notification);
  }
}
