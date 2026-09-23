import { z } from 'zod';
import { objectIdSchema } from './common.js';

export const NOTIFICATION_TYPES = [
  'mention',
  'task_assigned',
  'meeting_started',
  'summary_ready',
  'invite',
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/**
 * A notification.
 *
 * `payload` is intentionally loose: each type carries different context
 * (a meeting id, a task id, a team name) and pinning it down would mean a
 * discriminated union that has to change every time a new type is added.
 * The `title`/`body` are rendered directly, so the client never needs to
 * understand the payload to display the notification - only to link from it.
 */
export const notificationSchema = z.object({
  id: objectIdSchema,
  type: notificationTypeSchema,
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const notificationListSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;
