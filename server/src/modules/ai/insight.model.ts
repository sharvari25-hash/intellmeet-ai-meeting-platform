import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { ACTION_ITEM_STATUSES } from '@intellmeet/shared';

const actionItemSchema = new Schema(
  {
    text: { type: String, required: true },
    // Kept even when it matched nobody, so the UI can show "Sam (not in this
    // meeting)" and the host can fix it, instead of the name vanishing.
    assigneeName: { type: String, default: null },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dueDate: { type: String, default: null },
    status: { type: String, enum: ACTION_ITEM_STATUSES, default: 'open' },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
  },
  { _id: false },
);

/** The AI's reading of a meeting: summary, decisions, and who does what. */
const meetingInsightSchema = new Schema(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
    summary: { type: String, required: true },
    keyDecisions: { type: [String], default: [] },
    actionItems: { type: [actionItemSchema], default: [] },
    provider: { type: String, required: true },
  },
  { timestamps: true },
);

meetingInsightSchema.index({ summary: 'text', keyDecisions: 'text' });

// "My action items" (Phase 8) looks them up by assignee.
meetingInsightSchema.index({ 'actionItems.assigneeId': 1 });

export type MeetingInsightDocument = HydratedDocument<InferSchemaType<typeof meetingInsightSchema>>;

export const MeetingInsight = model('MeetingInsight', meetingInsightSchema);
