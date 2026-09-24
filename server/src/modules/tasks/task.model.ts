import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { TASK_PRIORITIES } from '@intellmeet/shared';

const taskSchema = new Schema(
  {
    boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
    // Copied from the board: "my tasks in my teams" and the team-scoped
    // cleanups then need no join.
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    columnId: { type: Schema.Types.ObjectId, required: true },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    assigneeId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // `YYYY-MM-DD`, like an action item's deadline: a day, not an instant, so
    // "due Friday" means Friday wherever the reader is.
    dueDate: { type: String, default: null },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },

    // Fractional position in the column (see `orderBetween` in shared).
    order: { type: Number, required: true },

    // Where it came from, when it was made from a meeting's action item. The
    // pair is unique, so a double-clicked "Create task" makes one task.
    sourceMeetingId: { type: Schema.Types.ObjectId, ref: 'Meeting', default: null },
    sourceActionItemId: { type: Schema.Types.ObjectId, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Bumped by every write, so clients can drop a real-time event older than
    // what they already have.
    version: { type: Number, default: 1 },

    // A sample task on the seeded demo board. The demo cleanup never deletes
    // these, and only a team admin may edit or delete them.
    seeded: { type: Boolean, default: false },
    seedKey: { type: String },
  },
  { timestamps: true },
);

// Loading a board, column by column, in order.
taskSchema.index({ boardId: 1, columnId: 1, order: 1 });

// "My tasks", soonest due first.
taskSchema.index({ assigneeId: 1, dueDate: 1 });

// Everything a guest made goes with the guest.
taskSchema.index({ createdBy: 1 });

// Analytics: a team's tasks created in a range of days, across its boards.
taskSchema.index({ teamId: 1, createdAt: 1 });

taskSchema.index(
  { sourceMeetingId: 1, sourceActionItemId: 1 },
  { unique: true, partialFilterExpression: { sourceActionItemId: { $type: 'objectId' } } },
);

taskSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export type TaskDocument = HydratedDocument<InferSchemaType<typeof taskSchema>>;

export const Task = model('Task', taskSchema);
