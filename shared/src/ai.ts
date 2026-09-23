import { z } from 'zod';
import { httpsUrlSchema, objectIdSchema } from './common.js';
import { aiStatusSchema } from './meeting.js';
import { uploadSignatureSchema } from './upload.js';

/**
 * Recording and AI meeting intelligence (Phase 6).
 *
 * The flow these schemas describe: the host records the mixed audio of the
 * call, uploads it, and registers it against the meeting. That enqueues a job
 * which transcribes the audio, asks a language model for a summary, key
 * decisions and action items, and matches each action item's assignee to a
 * meeting participant.
 */

// --- Recording upload ------------------------------------------------------

/**
 * Where the browser should send a finished recording.
 *
 * Decided by the server, not the client, because it depends on configuration
 * the client cannot see: with Cloudinary credentials the file goes straight
 * to Cloudinary (it never touches our API, which keeps it off Render's free
 * tier), and without them it is uploaded to the API and kept on local disk, so
 * the whole pipeline still works on a development machine with no accounts.
 */
export const recordingUploadTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cloudinary'), signature: uploadSignatureSchema }),
  z.object({
    kind: z.literal('server'),
    /** Path (under /api) to PUT the raw audio body to. */
    uploadPath: z.string(),
    /** Largest body the endpoint accepts, so the client can refuse early. */
    maxBytes: z.number().int().positive(),
  }),
]);
export type RecordingUploadTarget = z.infer<typeof recordingUploadTargetSchema>;

/** Registers a recording that was uploaded straight to Cloudinary. */
export const saveRecordingSchema = z.object({
  url: httpsUrlSchema,
  publicId: z.string().trim().min(1).max(300),
  /** Seconds, as measured by the recorder. Cloudinary's own value can lag. */
  durationSec: z.coerce
    .number()
    .min(0)
    .max(24 * 60 * 60),
});
export type SaveRecordingInput = z.infer<typeof saveRecordingSchema>;

/** Query string for the server-side upload, which has no JSON body to carry it. */
export const recordingFileQuerySchema = z.object({
  durationSec: z.coerce
    .number()
    .min(0)
    .max(24 * 60 * 60),
});

// --- AI output ---------------------------------------------------------------

export const transcriptSegmentSchema = z.object({
  /** Seconds from the start of the recording. */
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  /** Known only when the source says who spoke (seeded meetings, fixtures). */
  speaker: z.string().nullable(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  meetingId: objectIdSchema,
  text: z.string(),
  segments: z.array(transcriptSegmentSchema),
  language: z.string().nullable(),
  provider: z.string(),
  createdAt: z.string(),
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const ACTION_ITEM_STATUSES = ['open', 'done'] as const;

export const actionItemSchema = z.object({
  text: z.string(),
  /** The name as the model heard it, kept even when it matches nobody. */
  assigneeName: z.string().nullable(),
  /** Set when `assigneeName` was matched to a meeting participant. */
  assigneeId: objectIdSchema.nullable(),
  /** ISO date (YYYY-MM-DD), only when a deadline was actually stated. */
  dueDate: z.string().nullable(),
  status: z.enum(ACTION_ITEM_STATUSES),
  /** The Kanban task created from this item (Phase 8). */
  taskId: objectIdSchema.nullable(),
});
export type ActionItem = z.infer<typeof actionItemSchema>;

export const meetingInsightSchema = z.object({
  meetingId: objectIdSchema,
  summary: z.string(),
  keyDecisions: z.array(z.string()),
  actionItems: z.array(actionItemSchema),
  provider: z.string(),
  createdAt: z.string(),
});
export type MeetingInsight = z.infer<typeof meetingInsightSchema>;

/** Everything the meeting page needs about the AI pipeline, in one request. */
export const meetingIntelligenceSchema = z.object({
  meetingId: objectIdSchema,
  aiStatus: aiStatusSchema,
  /** Why the last run failed, in words fit for the UI. Null unless `failed`. */
  aiError: z.string().nullable(),
  transcript: transcriptSchema.nullable(),
  insight: meetingInsightSchema.nullable(),
});
export type MeetingIntelligence = z.infer<typeof meetingIntelligenceSchema>;

// --- Socket payloads ---------------------------------------------------------

/** Client -> server: the host started or stopped recording. */
export const recordingStateSchema = z.object({
  meetingId: objectIdSchema,
  recording: z.boolean(),
});
export type RecordingStatePayload = z.infer<typeof recordingStateSchema>;

/** Server -> room: somebody is (or is no longer) recording this meeting. */
export const recordingStateEventSchema = recordingStateSchema.extend({
  byUserId: objectIdSchema.nullable(),
});
export type RecordingStateEvent = z.infer<typeof recordingStateEventSchema>;

/** Server -> participants: the pipeline moved on a step. */
export const aiStatusEventSchema = z.object({
  meetingId: objectIdSchema,
  status: aiStatusSchema,
  error: z.string().nullable(),
});
export type AiStatusEvent = z.infer<typeof aiStatusEventSchema>;
