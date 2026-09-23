import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { NOTIFICATION_TYPES } from '@intellmeet/shared';

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 500 },
    // Free-form context (meetingId, taskId, teamName...). Kept loose on
    // purpose: a discriminated union here would have to change every time a
    // notification type is added, for no gain - the client links from it but
    // renders `title`/`body`.
    payload: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The bell icon asks "my notifications, newest first" on every page load.
notificationSchema.index({ userId: 1, createdAt: -1 });

// Unread badge count, without scanning the user's whole history.
notificationSchema.index({ userId: 1, readAt: 1 });

export type NotificationDocument = HydratedDocument<InferSchemaType<typeof notificationSchema>>;

export const Notification = model('Notification', notificationSchema);
