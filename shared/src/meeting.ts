import { z } from 'zod';
import { objectIdSchema } from './common.js';

/**
 * A meeting's lifecycle.
 *
 * `scheduled` -> `live` -> `ended` is one-way. There is deliberately no
 * "cancelled": deleting a scheduled meeting is the same thing with fewer
 * states to reason about in the UI.
 */
export const MEETING_STATUSES = ['scheduled', 'live', 'ended'] as const;
export const meetingStatusSchema = z.enum(MEETING_STATUSES);
export type MeetingStatus = z.infer<typeof meetingStatusSchema>;

/** Progress of the post-meeting AI pipeline (driven in Phase 6). */
export const AI_STATUSES = [
  'none',
  'queued',
  'transcribing',
  'summarizing',
  'done',
  'failed',
] as const;
export const aiStatusSchema = z.enum(AI_STATUSES);
export type AiStatus = z.infer<typeof aiStatusSchema>;

/**
 * Room codes are typed by humans from a chat message or read aloud on a call,
 * so they use the same unambiguous alphabet as invite codes (no I/L/O/U/0/1).
 */
export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^[A-Z2-9]{6,10}$/, 'Invalid room code'));

export const createMeetingSchema = z.object({
  teamId: objectIdSchema,
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(140),
  description: z.string().trim().max(2000).optional(),
  /**
   * Omit to start immediately. Present means "schedule for later", which is
   * the only difference between the two flows the plan calls for.
   */
  scheduledAt: z.iso.datetime({ message: 'Must be an ISO-8601 timestamp' }).optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z
  .object({
    title: z.string().trim().min(2).max(140).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    scheduledAt: z.iso.datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const listMeetingsQuerySchema = z.object({
  teamId: objectIdSchema.optional(),
  status: meetingStatusSchema.optional(),
  /** Free-text search across titles, backed by a Mongo text index. */
  q: z.string().trim().max(140).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;

export const meetingParticipantSchema = z.object({
  userId: objectIdSchema,
  name: z.string(),
  avatarUrl: z.string().nullable(),
  joinedAt: z.string(),
  leftAt: z.string().nullable(),
});
export type MeetingParticipant = z.infer<typeof meetingParticipantSchema>;

export const recordingSchema = z.object({
  url: z.string(),
  publicId: z.string(),
  durationSec: z.number().nonnegative(),
  status: z.enum(['none', 'uploading', 'ready', 'failed']),
});

export const meetingSchema = z.object({
  id: objectIdSchema,
  teamId: objectIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  hostId: objectIdSchema,
  hostName: z.string(),
  status: meetingStatusSchema,
  roomCode: z.string(),
  scheduledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** Seconds between start and end; null while the meeting has not ended. */
  durationSec: z.number().nullable(),
  participants: z.array(meetingParticipantSchema),
  recording: recordingSchema.nullable(),
  aiStatus: aiStatusSchema,
  /** True when the requesting user is the host, so the UI can show controls. */
  isHost: z.boolean(),
  createdAt: z.string(),
});
export type Meeting = z.infer<typeof meetingSchema>;

export const meetingListSchema = z.object({
  meetings: z.array(meetingSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
});
export type MeetingList = z.infer<typeof meetingListSchema>;

export const roomCodeParamsSchema = z.object({ roomCode: roomCodeSchema });
