import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { AI_STATUSES, MEETING_STATUSES } from '@intellmeet/shared';

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, required: true, default: Date.now },
    // Null while the participant is still in the room. Set on leave, so the
    // attendance record survives the meeting and the Redis room state.
    leftAt: { type: Date, default: null },
  },
  { _id: false },
);

const recordingSchema = new Schema(
  {
    url: { type: String },
    publicId: { type: String },
    durationSec: { type: Number, default: 0 },
    // Where the file lives. 'local' is the no-Cloudinary development path: the
    // audio sits on the API's disk and the AI job reads it from there.
    storage: { type: String, enum: ['cloudinary', 'local'], default: 'cloudinary' },
    // The container the browser produced (Chrome: webm/opus, Safari: mp4/aac).
    // Transcription APIs and ffmpeg both need to know which.
    mimeType: { type: String, default: 'audio/webm' },
    status: {
      type: String,
      enum: ['none', 'uploading', 'ready', 'failed'],
      default: 'none',
    },
  },
  { _id: false },
);

const meetingSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, trim: true, maxlength: 2000, default: null },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    status: { type: String, enum: MEETING_STATUSES, default: 'scheduled' },

    // Short, human-typeable join code. Unique across all meetings, including
    // ended ones, so a stale link can never silently resolve to a new meeting.
    roomCode: { type: String, required: true, unique: true, uppercase: true },

    scheduledAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    participants: { type: [participantSchema], default: [] },
    recording: { type: recordingSchema, default: () => ({ status: 'none' }) },
    aiStatus: { type: String, enum: AI_STATUSES, default: 'none' },
    // Why the last AI run failed, worded for the UI. Cleared on every retry.
    aiError: { type: String, default: null },

    // Past meetings created by the seed script so the demo workspace is not
    // empty. The demo cleanup never deletes these, however old they are.
    seeded: { type: Boolean, default: false },
    // Stable identity for a seeded meeting, which is what makes re-running the
    // seed an update rather than a duplicate. Absent on every real meeting.
    seedKey: { type: String },
  },
  { timestamps: true },
);

// "Meetings for this team, newest first" is the dashboard's primary query,
// and the status filter narrows it further.
meetingSchema.index({ teamId: 1, status: 1, createdAt: -1 });

// Text search across titles. Phase 6 adds Transcript and MeetingInsight to
// the searchable set; they are separate collections, so each gets its own
// text index rather than this one growing.
meetingSchema.index({ title: 'text', description: 'text' });

meetingSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export type MeetingDocument = HydratedDocument<InferSchemaType<typeof meetingSchema>>;

export const Meeting = model('Meeting', meetingSchema);
