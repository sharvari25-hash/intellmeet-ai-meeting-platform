import { Types } from 'mongoose';
import {
  chatMessageSchema,
  type ChatMessage,
  type MessageHistory,
  type MessageHistoryQuery,
} from '@intellmeet/shared';
import { User } from '../users/user.model.js';
import { Message, type MessageDocument } from './message.model.js';

/**
 * Chat messages carry the sender's name and avatar denormalised into the
 * payload.
 *
 * A message is read far more often than the sender's profile changes, and the
 * alternative - the client resolving every `senderId` against a user cache -
 * means a socket broadcast cannot be rendered until that lookup completes.
 * The cost is that a renamed user's older messages keep the old name, which is
 * how most chat products behave anyway.
 */
function toChatMessage(
  message: MessageDocument,
  sender: { name: string; avatarUrl?: string | null } | undefined,
): ChatMessage {
  return chatMessageSchema.parse({
    id: message._id.toString(),
    meetingId: message.meetingId.toString(),
    senderId: message.senderId.toString(),
    senderName: sender?.name ?? 'Unknown user',
    senderAvatarUrl: sender?.avatarUrl ?? null,
    text: message.text,
    createdAt: message.createdAt.toISOString(),
  });
}

/**
 * Persists a message and returns it in broadcast shape.
 *
 * Persisting before broadcasting is deliberate: a message that appears in
 * everyone's window but is missing from the history after a refresh is worse
 * than one that arrives a few milliseconds later.
 */
export async function createMessage(
  meetingId: string,
  senderId: string,
  text: string,
): Promise<ChatMessage> {
  const message = await Message.create({
    meetingId: new Types.ObjectId(meetingId),
    senderId: new Types.ObjectId(senderId),
    text,
  });

  const sender = await User.findById(senderId).select('name avatarUrl');
  return toChatMessage(message, sender ?? undefined);
}

/**
 * Returns a page of history, newest page first but oldest message first
 * within the page.
 *
 * The cursor is a timestamp rather than an offset because chat is
 * append-heavy: with `skip`, every message sent while the user is scrolling
 * shifts the window and duplicates or hides a row.
 */
export async function getHistory(
  meetingId: string,
  query: MessageHistoryQuery,
): Promise<MessageHistory> {
  const filter: Record<string, unknown> = { meetingId: new Types.ObjectId(meetingId) };
  if (query.before) filter.createdAt = { $lt: new Date(query.before) };

  // Fetch one extra row to find out whether an older page exists, rather than
  // running a second count query.
  // `_id` breaks ties so ordering is stable when two messages land in the same
  // millisecond. The cursor itself is still a timestamp, so a burst spanning a
  // page boundary within one millisecond could skip a message - acceptable at
  // human typing speeds, and the alternative is a compound cursor the client
  // would have to carry.
  const docs = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1);

  const hasMore = docs.length > query.limit;
  const page = hasMore ? docs.slice(0, query.limit) : docs;

  const senderIds = [...new Set(page.map((doc) => doc.senderId.toString()))];
  const users = await User.find({ _id: { $in: senderIds } }).select('name avatarUrl');
  const byId = new Map(users.map((user) => [user._id.toString(), user]));

  // Reverse so the caller can append straight to the bottom of the list.
  const messages = page
    .slice()
    .reverse()
    .map((doc) => toChatMessage(doc, byId.get(doc.senderId.toString()) ?? undefined));

  return {
    messages,
    nextCursor: hasMore ? (page.at(-1)?.createdAt.toISOString() ?? null) : null,
  };
}
