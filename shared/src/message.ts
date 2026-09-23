import { z } from 'zod';
import { objectIdSchema } from './common.js';

/** A persisted chat message, as returned by REST and broadcast over the socket. */
export const chatMessageSchema = z.object({
  id: objectIdSchema,
  meetingId: objectIdSchema,
  senderId: objectIdSchema,
  senderName: z.string(),
  senderAvatarUrl: z.string().nullable(),
  text: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/**
 * Cursor pagination, not page numbers.
 *
 * Chat history is append-heavy and read newest-first, so an offset would shift
 * under the reader every time somebody sends a message. The cursor is the
 * `createdAt` of the oldest message already loaded; the server returns the
 * page immediately before it.
 */
export const messageHistoryQuerySchema = z.object({
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessageHistoryQuery = z.infer<typeof messageHistoryQuerySchema>;

export const messageHistorySchema = z.object({
  /** Oldest first, so the client can append without reversing. */
  messages: z.array(chatMessageSchema),
  /** Cursor for the next (older) page, or null when the start is reached. */
  nextCursor: z.string().nullable(),
});
export type MessageHistory = z.infer<typeof messageHistorySchema>;
