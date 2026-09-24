import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * A comment on a task.
 *
 * Its own collection rather than an array on the task: a busy task's
 * discussion would otherwise grow the document every board load reads in
 * full. The count shown on each card is aggregated per board load instead.
 */
const taskCommentSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// A task's thread, oldest first.
taskCommentSchema.index({ taskId: 1, createdAt: 1 });

// Everything a guest wrote goes with the guest.
taskCommentSchema.index({ authorId: 1 });

export type TaskCommentDocument = HydratedDocument<InferSchemaType<typeof taskCommentSchema>>;

export const TaskComment = model('TaskComment', taskCommentSchema);
