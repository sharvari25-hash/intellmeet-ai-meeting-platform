import { Types } from 'mongoose';
import {
  notificationSchema,
  type Notification as NotificationDto,
  type NotificationList,
  type NotificationType,
} from '@intellmeet/shared';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { Notification, type NotificationDocument } from './notification.model.js';

function toNotificationDto(notification: NotificationDocument): NotificationDto {
  return notificationSchema.parse({
    id: notification._id.toString(),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    payload: notification.payload ?? {},
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    createdAt: notification.createdAt.toISOString(),
  });
}

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

/**
 * Creates notifications and hands them back for delivery.
 *
 * Deliberately does *not* push over the socket itself: that would make this
 * module import the socket layer, which already imports services, and the
 * cycle would be real rather than cosmetic. The caller - which knows whether
 * a socket server exists at all - does the emitting.
 */
export async function createNotifications(
  inputs: CreateNotificationInput[],
): Promise<{ userId: string; notification: NotificationDto }[]> {
  if (inputs.length === 0) return [];

  const docs = await Notification.insertMany(
    inputs.map((input) => ({
      userId: new Types.ObjectId(input.userId),
      type: input.type,
      title: input.title,
      body: input.body,
      payload: input.payload ?? {},
    })),
  );

  return docs.map((doc) => ({
    userId: doc.userId.toString(),
    notification: toNotificationDto(doc),
  }));
}

export async function listNotifications(
  userId: string,
  options: { unreadOnly: boolean; limit: number },
): Promise<NotificationList> {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (options.unreadOnly) filter.readAt = null;

  const [docs, unreadCount] = await Promise.all([
    // `_id` breaks ties: notifications created in the same batch share a
    // millisecond, and sorting on `createdAt` alone would render them in an
    // arbitrary order that changes between reads. ObjectIds increase
    // monotonically within a process, so they order a batch correctly.
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(options.limit),
    Notification.countDocuments({ userId: new Types.ObjectId(userId), readAt: null }),
  ]);

  return { notifications: docs.map(toNotificationDto), unreadCount };
}

export async function markRead(userId: string, notificationId: string): Promise<NotificationDto> {
  const notification = await Notification.findOne({
    _id: notificationId,
    // Scoped by userId in the query itself, so one user can never mark
    // another's notification as read by guessing an id.
    userId: new Types.ObjectId(userId),
  });

  if (!notification) throw AppError.notFound('Notification not found');

  notification.readAt ??= new Date();
  await notification.save();

  return toNotificationDto(notification);
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await Notification.updateMany(
    { userId: new Types.ObjectId(userId), readAt: null },
    { $set: { readAt: new Date() } },
  );

  return result.modifiedCount;
}

/**
 * Fire-and-forget delivery used by socket handlers.
 *
 * A failed notification must never break the action that triggered it - if
 * the database write fails, the meeting still started. The error is logged
 * and swallowed.
 */
export async function safeCreateNotifications(
  inputs: CreateNotificationInput[],
): Promise<{ userId: string; notification: NotificationDto }[]> {
  try {
    return await createNotifications(inputs);
  } catch (error) {
    logger.error({ err: error }, '[notifications] failed to create');
    return [];
  }
}
