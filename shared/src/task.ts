import { z } from 'zod';
import { isoDateSchema } from './ai.js';
import { objectIdSchema } from './common.js';
import { teamRoleSchema, type TeamRole } from './team.js';

/**
 * Team boards and tasks (Phase 8).
 *
 * A team has one or more boards; a board has an ordered list of columns; a
 * task sits in one column at a fractional `order`. Action items from a
 * meeting become tasks that keep a link back to the item they came from.
 */

// --- Limits ------------------------------------------------------------------

/** Enough for any real workflow, and a bound on what one request can build. */
export const MAX_COLUMNS = 12;

/**
 * A board is loaded whole, so it has to stay a size a phone can render. Also
 * what stops one reviewer filling the shared demo board for everyone else.
 */
export const MAX_TASKS_PER_BOARD = 300;

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/**
 * What every new board starts with. The last one counts as "done": a task
 * there is finished, so it is never overdue and My Tasks files it away.
 */
export const DEFAULT_COLUMNS = [
  { title: 'To Do', isDone: false },
  { title: 'In Progress', isDone: false },
  { title: 'Review', isDone: false },
  { title: 'Done', isDone: true },
] as const;

// --- Fractional ordering -------------------------------------------------------

/** The gap between neighbours when a column is laid out from scratch. */
export const ORDER_STEP = 1024;

/**
 * Below this gap two neighbours are too close to put anything between; the
 * column is renumbered instead. Halving from 1024 takes about 30 drops into
 * the same slot to get here, so it is rare, but the gap does run out.
 */
export const MIN_ORDER_GAP = 1e-6;

/**
 * The order for something placed between two neighbours (either may be
 * absent: the top or bottom of the column).
 *
 * This is what makes a move one write: only the moved task changes, instead
 * of renumbering everything below it. Returns null when there is no room left
 * between the two, which the server answers by renumbering the column.
 * Shared, so the optimistic position on the client is the one the server
 * will store.
 */
export function orderBetween(previous: number | null, next: number | null): number | null {
  if (previous === null && next === null) return ORDER_STEP;
  if (previous === null) return (next as number) - ORDER_STEP;
  if (next === null) return previous + ORDER_STEP;
  if (next - previous < MIN_ORDER_GAP * 2) return null;
  return previous + (next - previous) / 2;
}

// --- Permissions ---------------------------------------------------------------

/**
 * Who may do what to a task. Shared so the page only offers what the server
 * will allow.
 *
 * - Any team member creates tasks, moves any task and comments on any task:
 *   a board is the team's shared picture of the work.
 * - Any member edits a task, except the seeded sample tasks, which only an
 *   admin may change. Everyone who tries the demo shares those.
 * - A task is deleted by whoever created it, or by an admin. Deleting
 *   somebody else's work is an admin decision; this is also what stops one
 *   reviewer deleting another's tasks, or the samples, on the shared board.
 */
export function taskPermissions(input: {
  viewerId: string;
  viewerRole: TeamRole;
  task: { createdBy: string; seeded: boolean };
}): { canMove: boolean; canEdit: boolean; canDelete: boolean; canComment: boolean } {
  const admin = input.viewerRole === 'admin';
  return {
    canMove: true,
    canEdit: admin || !input.task.seeded,
    canDelete: admin || (!input.task.seeded && input.task.createdBy === input.viewerId),
    canComment: true,
  };
}

/**
 * Boards and their columns are the team's workflow, so only an admin creates,
 * renames, reorders or removes them. A demo guest is a member of the shared
 * demo team, and the admin of any team it creates for itself.
 */
export function canManageBoards(role: TeamRole): boolean {
  return role === 'admin';
}

// --- Boards --------------------------------------------------------------------

const columnTitleSchema = z.string().trim().min(1, 'Name the column').max(40);
const boardNameSchema = z.string().trim().min(2, 'Name the board').max(60);

export const boardColumnSchema = z.object({
  id: objectIdSchema,
  title: z.string(),
  /** A task in a "done" column is finished: never overdue. */
  isDone: z.boolean(),
});
export type BoardColumn = z.infer<typeof boardColumnSchema>;

export const boardSummarySchema = z.object({
  id: objectIdSchema,
  teamId: objectIdSchema,
  name: z.string(),
  /** Every team has one; tasks from meetings land on it. */
  isDefault: z.boolean(),
});
export type BoardSummary = z.infer<typeof boardSummarySchema>;

export const boardSchema = boardSummarySchema.extend({
  teamName: z.string(),
  /** In display order. */
  columns: z.array(boardColumnSchema),
  /** The seeded demo board, whose sample tasks are reset when it goes quiet. */
  seeded: z.boolean(),
  /** The requester's role in the board's team, so the page can offer admin actions. */
  myRole: teamRoleSchema,
  createdAt: z.string(),
});
export type Board = z.infer<typeof boardSchema>;

export const listBoardsQuerySchema = z.object({ teamId: objectIdSchema });

export const createBoardSchema = z.object({ teamId: objectIdSchema, name: boardNameSchema });
export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const renameBoardSchema = z.object({ name: boardNameSchema });

export const createColumnSchema = z.object({ title: columnTitleSchema });

export const updateColumnSchema = z
  .object({ title: columnTitleSchema.optional(), isDone: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;

/** The whole new order. A handful of columns: no need for anything cleverer. */
export const reorderColumnsSchema = z.object({
  columnIds: z.array(objectIdSchema).min(1).max(MAX_COLUMNS),
});

export const columnParamsSchema = z.object({ id: objectIdSchema, columnId: objectIdSchema });

// --- Tasks ---------------------------------------------------------------------

export const taskSourceSchema = z.object({
  meetingId: objectIdSchema,
  meetingTitle: z.string(),
  /**
   * The action item it came from. Kept if the host later rewords or removes
   * the item; null only when the link was handed to another task.
   */
  actionItemId: z.string().nullable(),
});

export const taskSchema = z.object({
  id: objectIdSchema,
  boardId: objectIdSchema,
  teamId: objectIdSchema,
  columnId: objectIdSchema,
  title: z.string(),
  description: z.string(),
  assigneeId: objectIdSchema.nullable(),
  assigneeName: z.string().nullable(),
  /** `YYYY-MM-DD`, like an action item's deadline. */
  dueDate: z.string().nullable(),
  priority: taskPrioritySchema,
  /** Position within the column; fractional, see `orderBetween`. */
  order: z.number(),
  /** The meeting it came from, if it was created from an action item. */
  source: taskSourceSchema.nullable(),
  createdBy: objectIdSchema,
  createdByName: z.string(),
  /** A sample task on the seeded demo board. */
  seeded: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  /**
   * Incremented by every write. Real-time events can arrive out of order
   * (two moves of the same task a few milliseconds apart), so a client keeps
   * the highest version it has seen and ignores anything older.
   */
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const boardDetailSchema = z.object({
  board: boardSchema,
  tasks: z.array(taskSchema),
});
export type BoardDetail = z.infer<typeof boardDetailSchema>;

const taskTitleSchema = z.string().trim().min(1, 'Give the task a title').max(200);
const taskDescriptionSchema = z.string().trim().max(5000);

export const createTaskSchema = z.object({
  title: taskTitleSchema,
  description: taskDescriptionSchema.optional(),
  /** Defaults to the first column. */
  columnId: objectIdSchema.optional(),
  assigneeId: objectIdSchema.nullable().optional(),
  dueDate: isoDateSchema.nullable().optional(),
  priority: taskPrioritySchema.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    assigneeId: objectIdSchema.nullable().optional(),
    dueDate: isoDateSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * A move, described by where the task lands rather than by a number: the
 * neighbours it was dropped between, as the client saw them. The server
 * computes the order from its own copy of those neighbours, so a client with
 * a slightly stale board still lands the task where the person dropped it.
 */
export const moveTaskSchema = z.object({
  columnId: objectIdSchema,
  /** The task it now follows; null or absent at the top of the column. */
  afterId: objectIdSchema.nullable().optional(),
  /** The task it now precedes; null or absent at the bottom. */
  beforeId: objectIdSchema.nullable().optional(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

/** The answer to a move, and its broadcast. */
export const taskMovedSchema = z.object({
  boardId: objectIdSchema,
  task: taskSchema,
  /**
   * Other tasks whose order changed because the column had to be renumbered
   * (see `MIN_ORDER_GAP`). Almost always empty.
   */
  reordered: z.array(z.object({ id: objectIdSchema, order: z.number() })),
});
export type TaskMoved = z.infer<typeof taskMovedSchema>;

// --- Comments ------------------------------------------------------------------

export const taskCommentSchema = z.object({
  id: objectIdSchema,
  taskId: objectIdSchema,
  authorId: objectIdSchema,
  authorName: z.string(),
  authorAvatarUrl: z.string().nullable(),
  text: z.string(),
  createdAt: z.string(),
});
export type TaskComment = z.infer<typeof taskCommentSchema>;

export const createCommentSchema = z.object({
  text: z.string().trim().min(1, 'Write a comment').max(2000),
});

export const taskCommentListSchema = z.object({ comments: z.array(taskCommentSchema) });

// --- My tasks ------------------------------------------------------------------

/** A task with the context a list across every board needs. */
export const myTaskSchema = taskSchema.extend({
  boardName: z.string(),
  teamName: z.string(),
  columnTitle: z.string(),
  isDone: z.boolean(),
});
export type MyTask = z.infer<typeof myTaskSchema>;

export const myTaskListSchema = z.object({ tasks: z.array(myTaskSchema) });

// --- Tasks from a meeting's action items ------------------------------------------

export const createTasksFromActionItemsSchema = z.object({
  /** Defaults to the meeting team's default board. */
  boardId: objectIdSchema.optional(),
  items: z
    .array(
      z.object({
        actionItemId: z.string().min(1).max(64),
        /** Pre-filled from the AI's match; the person creating may change it. */
        assigneeId: objectIdSchema.nullable(),
        dueDate: isoDateSchema.nullable(),
        priority: taskPrioritySchema.optional(),
      }),
    )
    .min(1, 'Choose at least one action item')
    .max(100),
});
export type CreateTasksFromActionItemsInput = z.infer<typeof createTasksFromActionItemsSchema>;

// --- Socket payloads -------------------------------------------------------------

/** Client -> server: start or stop receiving a board's live updates. */
export const boardRoomSchema = z.object({ boardId: objectIdSchema });

/** Server -> board room: a task was created or edited. */
export const taskEventSchema = z.object({ boardId: objectIdSchema, task: taskSchema });
export type TaskEvent = z.infer<typeof taskEventSchema>;

export const taskDeletedEventSchema = z.object({
  boardId: objectIdSchema,
  taskId: objectIdSchema,
});
export type TaskDeletedEvent = z.infer<typeof taskDeletedEventSchema>;

export const taskCommentedEventSchema = z.object({
  boardId: objectIdSchema,
  taskId: objectIdSchema,
  comment: taskCommentSchema,
  commentCount: z.number().int().nonnegative(),
});
export type TaskCommentedEvent = z.infer<typeof taskCommentedEventSchema>;

/**
 * Server -> board room: reload the board. Sent when its columns change, when
 * the sample tasks are reset, and when a guest leaves and takes its tasks
 * with it - changes too broad to describe task by task.
 */
export const boardRefreshEventSchema = z.object({ boardId: objectIdSchema });
