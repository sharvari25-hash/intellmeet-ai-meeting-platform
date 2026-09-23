import { z } from 'zod';
import {
  notificationListSchema,
  notificationSchema,
  type NotificationList,
} from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const markReadResponseSchema = z.object({ notification: notificationSchema });
const markAllReadResponseSchema = z.object({ updated: z.number().int().nonnegative() });

export const notificationKeys = {
  all: ['notifications'] as const,
};

export function listNotifications(): Promise<NotificationList> {
  return api('/notifications', notificationListSchema);
}

export function markRead(id: string): Promise<void> {
  return api(`/notifications/${id}/read`, markReadResponseSchema, { method: 'PATCH' }).then(
    () => undefined,
  );
}

export function markAllRead(): Promise<number> {
  return api('/notifications/read-all', markAllReadResponseSchema, { method: 'PATCH' }).then(
    (result) => result.updated,
  );
}
