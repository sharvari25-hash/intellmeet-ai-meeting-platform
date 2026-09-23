import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

const messageSchema = new Schema(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Chat history is always "this meeting, newest first, before a cursor".
// The compound index serves the filter and the sort in one pass, so paging
// back through a long meeting never degrades into a collection scan.
messageSchema.index({ meetingId: 1, createdAt: -1 });

export type MessageDocument = HydratedDocument<InferSchemaType<typeof messageSchema>>;

export const Message = model('Message', messageSchema);
