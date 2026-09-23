import { SOCKET_EVENTS, socketRooms, type Meeting as MeetingDto } from '@intellmeet/shared';
import { logger } from '../../lib/logger.js';
import { getIo } from '../../sockets/index.js';
import { Team } from '../teams/team.model.js';
import { safeCreateNotifications } from '../notifications/notification.service.js';

/**
 * Tells a host's team-mates that a meeting has gone live.
 *
 * This lives in the meetings module rather than in the socket layer because
 * its only caller is the REST controller, and the socket layer already imports
 * `meeting.service` - putting it there and importing it back would be a real
 * cycle. The dependency only runs one way: this module reaches into
 * `getIo()`, and nothing in `sockets/` knows this file exists.
 *
 * Persistence and delivery are deliberately separate concerns. The
 * notification is written first and emitted afterwards, so someone who was
 * offline when the meeting started still finds it in the bell on their next
 * page load. If no socket server is running - during tests, or before startup
 * finishes - the rows are still written and only the live push is skipped.
 *
 * Nothing here can fail the request that triggered it: the meeting has
 * genuinely started, and a failed notification must not undo that.
 */
export async function announceMeetingStarted(meeting: MeetingDto): Promise<void> {
  try {
    const team = await Team.findById(meeting.teamId).select('members.userId');
    if (!team) return;

    // Everyone but the host: the person who pressed Start does not need to be
    // told, and a self-notification in the bell reads as a bug.
    const recipientIds = team.members
      .map((member) => member.userId.toString())
      .filter((userId) => userId !== meeting.hostId);

    if (recipientIds.length === 0) return;

    const created = await safeCreateNotifications(
      recipientIds.map((userId) => ({
        userId,
        type: 'meeting_started' as const,
        title: 'Meeting started',
        body: `"${meeting.title}" has started`,
        // Enough context for the bell to link straight into the room without
        // a second round trip.
        payload: {
          meetingId: meeting.id,
          teamId: meeting.teamId,
          roomCode: meeting.roomCode,
          hostName: meeting.hostName,
        },
      })),
    );

    const io = getIo();
    if (!io) return;

    for (const { userId, notification } of created) {
      // Addressed to the account's private room, so every tab that person has
      // open lights up rather than one arbitrary socket.
      io.to(socketRooms.user(userId)).emit(SOCKET_EVENTS.NOTIFY_NEW, notification);
    }
  } catch (error) {
    logger.error({ err: error, meetingId: meeting.id }, '[meetings] failed to announce start');
  }
}
