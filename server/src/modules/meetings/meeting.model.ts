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

export type MeetingDocument = HydratedDocument<InferSchemaType<typeof meetingSchema>>;

export const Meeting = model('Meeting', meetingSchema);
