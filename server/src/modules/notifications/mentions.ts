import { findMentions, type Notification } from '@intellmeet/shared';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { safeCreateNotifications } from './notification.service.js';

/** Titles and bodies are capped by the model; a long message is shortened, not refused. */
function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Saves a `mention` notification for everyone `text` mentions.
 *
 * Only members of the team can be mentioned: they are the people who can
 * open the meeting or the task the notification links to. Mentioning
 * yourself notifies nobody. Returns what was saved, for the caller to push
 * over the socket; never throws, because a failed notification must not
 * fail the message or comment that caused it.
 *
 * Nothing is loaded unless the text contains an `@`, which most messages do
 * not.
 */
export async function createMentionNotifications(input: {
  text: string;
  authorId: string;
  teamId: string;
  /** Where it was said, for the title: "the meeting chat", "a task". */
  where: string;
  /** What the notification links to (meetingId, taskId, boardId...). */
  payload: Record<string, unknown>;
}): Promise<{ userId: string; notification: Notification }[]> {
  if (!input.text.includes('@')) return [];

  const team = await Team.findById(input.teamId).select('members.userId');
  if (!team) return [];

  const members = await User.find({ _id: { $in: team.members.map((m) => m.userId) } }).select(
    'name',
  );
  const people = members.map((member) => ({ id: member._id.toString(), name: member.name }));
  const author = people.find((person) => person.id === input.authorId);

  const mentioned = findMentions(input.text, people).filter(
    (person) => person.id !== input.authorId,
  );
  if (mentioned.length === 0) return [];

  return safeCreateNotifications(
    mentioned.map((person) => ({
      userId: person.id,
      type: 'mention' as const,
      title: shorten(`${author?.name ?? 'Someone'} mentioned you in ${input.where}`, 140),
      body: shorten(input.text, 500),
      payload: input.payload,
    })),
  );
}
