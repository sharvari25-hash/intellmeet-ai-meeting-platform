import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * A column. Its `_id` is the stable id tasks point at, so renaming or
 * reordering columns never touches a task. Order is the column's position in
 * the array: a board has a handful, reordered as a whole list, so there is
 * nothing to gain from a separate order field.
 */
const columnSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 40 },
  isDone: { type: Boolean, default: false },
});

const boardSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: 'Team', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    columns: { type: [columnSchema], default: [] },

    // Every team has exactly one default board, created the first time the
    // team's boards are listed. Tasks made from meeting action items go there.
    isDefault: { type: Boolean, default: false },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // The seeded demo board. Its sample tasks go back to where the seed put
    // them once the board has been quiet for DEMO_BOARD_RESET_IDLE_MIN.
    seeded: { type: Boolean, default: false },
    seedKey: { type: String },

    // When a task on this board was last created, changed, moved or deleted;
    // and when the seeded tasks were last put back. The reset only runs when
    // there has been activity since the last one, and none for a while.
    activityAt: { type: Date, default: null },
    restoredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// "This team's boards", on every visit to the task page.
boardSchema.index({ teamId: 1, createdAt: 1 });

// At most one default board per team, however many requests race to create it.
boardSchema.index({ teamId: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });

boardSchema.index({ seedKey: 1 }, { unique: true, sparse: true });

export type BoardDocument = HydratedDocument<InferSchemaType<typeof boardSchema>>;

export const Board = model('Board', boardSchema);
