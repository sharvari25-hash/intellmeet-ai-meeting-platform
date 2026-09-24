import { Types } from 'mongoose';
import {
  MAX_TASKS_PER_BOARD,
  ORDER_STEP,
  myTaskSchema,
  taskCommentSchema,
  taskPermissions,
  taskSchema,
  type BoardDetail,
  type CreateTaskInput,
  type MoveTaskInput,
  type MyTask,
  type Task as TaskDto,
  type TaskComment as TaskCommentDto,
  type TaskMoved,
  type UpdateTaskInput,
} from '@intellmeet/shared';
import { AppError, isAppError } from '../../lib/errors.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Team, type TeamDocument } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { Board, type BoardDocument } from './board.model.js';
import { getBoardForMember, toBoardDto, touchBoards, type BoardAccess } from './board.service.js';
import { TaskComment } from './comment.model.js';
import { deleteTasksWhere } from './task.cleanup.js';
import { Task, type TaskDocument } from './task.model.js';
import { placeTask } from './task.order.js';

// --- Serialising -------------------------------------------------------------------

/**
 * Tasks as the client sees them.
 *
 * Batched: everyone they mention, the meetings they came from and their
 * comment counts are each one query for the whole set, so a board of a
 * hundred tasks costs four queries rather than four hundred.
 */
export async function toTaskDtos(tasks: TaskDocument[]): Promise<TaskDto[]> {
  if (tasks.length === 0) return [];

  const userIds = new Set<string>();
  const meetingIds = new Set<string>();
  for (const task of tasks) {
    userIds.add(task.createdBy.toString());
    if (task.assigneeId) userIds.add(task.assigneeId.toString());
    if (task.sourceMeetingId) meetingIds.add(task.sourceMeetingId.toString());
  }

  const [users, meetings, counts] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('name'),
    Meeting.find({ _id: { $in: [...meetingIds] } }).select('title'),
    TaskComment.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
      { $group: { _id: '$taskId', count: { $sum: 1 } } },
    ]),
  ]);

  const names = new Map(users.map((user) => [user._id.toString(), user.name]));
  const titles = new Map(meetings.map((meeting) => [meeting._id.toString(), meeting.title]));
  const commentCounts = new Map(counts.map((entry) => [entry._id.toString(), entry.count]));

  return tasks.map((task) => {
    const assigneeId = task.assigneeId?.toString() ?? null;
    const meetingId = task.sourceMeetingId?.toString() ?? null;

    return taskSchema.parse({
      id: task._id.toString(),
      boardId: task.boardId.toString(),
      teamId: task.teamId.toString(),
      columnId: task.columnId.toString(),
      title: task.title,
      description: task.description ?? '',
      assigneeId,
      // An assignee whose account has gone still owned it; say so, not nothing.
      assigneeName: assigneeId ? (names.get(assigneeId) ?? 'Former member') : null,
      dueDate: task.dueDate ?? null,
      priority: task.priority,
      order: task.order,
      source: meetingId
        ? {
            meetingId,
            meetingTitle: titles.get(meetingId) ?? 'A meeting',
            actionItemId: task.sourceActionItemId?.toString() ?? null,
          }
        : null,
      createdBy: task.createdBy.toString(),
      createdByName: names.get(task.createdBy.toString()) ?? 'Former member',
      seeded: task.seeded ?? false,
      commentCount: commentCounts.get(task._id.toString()) ?? 0,
      version: task.version ?? 1,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    });
  });
}

async function toTaskDto(task: TaskDocument): Promise<TaskDto> {
  const [dto] = await toTaskDtos([task]);
  if (!dto) throw AppError.internal('A task could not be serialised');
  return dto;
}

// --- Access ----------------------------------------------------------------------

interface TaskAccess extends BoardAccess {
  task: TaskDocument;
}

/**
 * Loads a task the user may see, with its board and the user's team role.
 * A task on a board the user cannot see is "not found", like the board.
 */
async function getTaskForMember(taskId: string, userId: string): Promise<TaskAccess> {
  const task = await Task.findById(taskId);
  if (!task) throw AppError.notFound('Task not found');

  try {
    return { task, ...(await getBoardForMember(task.boardId.toString(), userId)) };
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND') throw AppError.notFound('Task not found');
    throw error;
  }
}

function permissionsFor(access: TaskAccess, userId: string) {
  return taskPermissions({
    viewerId: userId,
    viewerRole: access.role,
    task: { createdBy: access.task.createdBy.toString(), seeded: access.task.seeded ?? false },
  });
}

function hasColumn(board: BoardDocument, columnId: string): boolean {
  return board.columns.some((column) => column._id.toString() === columnId);
}

/** Tasks go to people who can see them: members of the board's team. */
function assertAssignable(team: TeamDocument, assigneeId: string): void {
  if (!team.members.some((member) => member.userId.toString() === assigneeId)) {
    throw AppError.validation([
      { path: 'body.assigneeId', message: 'Tasks can only be assigned to members of this team' },
    ]);
  }
}

export async function assertBoardCapacity(boardId: Types.ObjectId, adding: number): Promise<void> {
  const count = await Task.countDocuments({ boardId });
  if (count + adding > MAX_TASKS_PER_BOARD) {
    throw AppError.conflict(
      `A board holds at most ${MAX_TASKS_PER_BOARD} tasks. Delete some finished ones first.`,
    );
  }
}

/** The order that puts a new task at the bottom of a column. */
export async function bottomOfColumn(
  boardId: Types.ObjectId,
  columnId: string | Types.ObjectId,
): Promise<number> {
  const last = await Task.findOne({ boardId, columnId }).sort({ order: -1 }).select('order');
  return last ? last.order + ORDER_STEP : ORDER_STEP;
}

// --- Boards with their tasks ---------------------------------------------------------

export async function getBoardDetail(boardId: string, userId: string): Promise<BoardDetail> {
  const { board, team, role } = await getBoardForMember(boardId, userId);
  const tasks = await Task.find({ boardId: board._id }).sort({ order: 1, _id: 1 });

  return { board: toBoardDto(board, team, role), tasks: await toTaskDtos(tasks) };
}

// --- Tasks -----------------------------------------------------------------------------

export async function createTask(
  boardId: string,
  userId: string,
  input: CreateTaskInput,
): Promise<TaskDto> {
  const { board, team } = await getBoardForMember(boardId, userId);

  const columnId = input.columnId ?? board.columns[0]?._id.toString();
  if (!columnId || !hasColumn(board, columnId)) {
    throw AppError.validation([
      { path: 'body.columnId', message: 'That column is not on this board' },
    ]);
  }
  if (input.assigneeId) assertAssignable(team, input.assigneeId);
  await assertBoardCapacity(board._id, 1);

  const task = await Task.create({
    boardId: board._id,
    teamId: board.teamId,
    columnId: new Types.ObjectId(columnId),
    title: input.title,
    description: input.description ?? '',
    assigneeId: input.assigneeId ? new Types.ObjectId(input.assigneeId) : null,
    dueDate: input.dueDate ?? null,
    priority: input.priority ?? 'medium',
    order: await bottomOfColumn(board._id, columnId),
    createdBy: new Types.ObjectId(userId),
  });

  await touchBoards([board._id]);
  return toTaskDto(task);
}

export async function getTask(taskId: string, userId: string): Promise<TaskDto> {
  const { task } = await getTaskForMember(taskId, userId);
  return toTaskDto(task);
}

export interface TaskUpdateResult {
  task: TaskDto;
  /** Set when this edit gave the task to somebody new (other than the editor). */
  newAssigneeId: string | null;
}

export async function updateTask(
  taskId: string,
  userId: string,
  input: UpdateTaskInput,
): Promise<TaskUpdateResult> {
  const access = await getTaskForMember(taskId, userId);
  if (!permissionsFor(access, userId).canEdit) {
    throw AppError.forbidden('Only a team admin can change a sample task. You can still move it.');
  }
  if (input.assigneeId) assertAssignable(access.team, input.assigneeId);

  const set: Record<string, unknown> = {};
  if (input.title !== undefined) set.title = input.title;
  if (input.description !== undefined) set.description = input.description;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.assigneeId !== undefined) {
    set.assigneeId = input.assigneeId ? new Types.ObjectId(input.assigneeId) : null;
  }

  const updated = await Task.findOneAndUpdate(
    { _id: access.task._id },
    { $set: set, $inc: { version: 1 } },
    { new: true },
  );
  if (!updated) throw AppError.notFound('Task not found');
  await touchBoards([access.board._id]);

  const before = access.task.assigneeId?.toString() ?? null;
  const after = updated.assigneeId?.toString() ?? null;

  return {
    task: await toTaskDto(updated),
    newAssigneeId: after && after !== before && after !== userId ? after : null,
  };
}

/**
 * Moves a task within or across columns. Any member may move any task,
 * sample tasks included: moving cards is the board.
 */
export async function moveTask(
  taskId: string,
  userId: string,
  input: MoveTaskInput,
): Promise<TaskMoved> {
  const access = await getTaskForMember(taskId, userId);
  if (!hasColumn(access.board, input.columnId)) {
    throw AppError.validation([
      { path: 'body.columnId', message: 'That column is not on this board' },
    ]);
  }

  const placement = await placeTask({
    boardId: access.board._id,
    columnId: input.columnId,
    taskId: access.task._id,
    afterId: input.afterId,
    beforeId: input.beforeId,
  });

  const updated = await Task.findOneAndUpdate(
    { _id: access.task._id },
    {
      $set: { columnId: new Types.ObjectId(input.columnId), order: placement.order },
      $inc: { version: 1 },
    },
    { new: true },
  );
  if (!updated) throw AppError.notFound('Task not found');
  await touchBoards([access.board._id]);

  return {
    boardId: access.board._id.toString(),
    task: await toTaskDto(updated),
    reordered: placement.reordered,
  };
}

export async function deleteTask(
  taskId: string,
  userId: string,
): Promise<{ boardId: string; taskId: string }> {
  const access = await getTaskForMember(taskId, userId);
  if (!permissionsFor(access, userId).canDelete) {
    throw AppError.forbidden(
      access.task.seeded
        ? 'Only a team admin can delete a sample task.'
        : 'Only the person who created this task, or a team admin, can delete it.',
    );
  }

  await deleteTasksWhere({ _id: access.task._id }, { includeSeeded: true });
  await touchBoards([access.board._id]);
  return { boardId: access.board._id.toString(), taskId };
}

// --- Comments ----------------------------------------------------------------------------

async function toCommentDtos(
  comments: {
    _id: Types.ObjectId;
    taskId: Types.ObjectId;
    authorId: Types.ObjectId;
    text: string;
    createdAt: Date;
  }[],
): Promise<TaskCommentDto[]> {
  const authors = await User.find({
    _id: { $in: [...new Set(comments.map((comment) => comment.authorId.toString()))] },
  }).select('name avatarUrl');
  const byId = new Map(authors.map((author) => [author._id.toString(), author]));

  return comments.map((comment) => {
    const author = byId.get(comment.authorId.toString());
    return taskCommentSchema.parse({
      id: comment._id.toString(),
      taskId: comment.taskId.toString(),
      authorId: comment.authorId.toString(),
      authorName: author?.name ?? 'Former member',
      authorAvatarUrl: author?.avatarUrl ?? null,
      text: comment.text,
      createdAt: comment.createdAt.toISOString(),
    });
  });
}

/** A task's discussion, oldest first. */
export async function listComments(taskId: string, userId: string): Promise<TaskCommentDto[]> {
  const { task } = await getTaskForMember(taskId, userId);
  const comments = await TaskComment.find({ taskId: task._id })
    .sort({ createdAt: 1, _id: 1 })
    .limit(500);
  return toCommentDtos(comments);
}

export interface CommentResult {
  comment: TaskCommentDto;
  commentCount: number;
  boardId: string;
  teamId: string;
  task: { id: string; title: string };
}

export async function addComment(
  taskId: string,
  userId: string,
  text: string,
): Promise<CommentResult> {
  const { task, board } = await getTaskForMember(taskId, userId);

  const created = await TaskComment.create({
    taskId: task._id,
    boardId: board._id,
    authorId: new Types.ObjectId(userId),
    text,
  });
  // A conversation is activity too: the demo board is not reset under it.
  await touchBoards([board._id]);
  const [comment] = await toCommentDtos([created]);
  if (!comment) throw AppError.internal('A comment could not be serialised');

  return {
    comment,
    commentCount: await TaskComment.countDocuments({ taskId: task._id }),
    boardId: board._id.toString(),
    teamId: board.teamId.toString(),
    task: { id: task._id.toString(), title: task.title },
  };
}

// --- My tasks -------------------------------------------------------------------------------

/**
 * Everything assigned to the user, on every board of every team they are in.
 * Scoped to current teams: a task on a team they have left is no longer theirs
 * to see.
 */
export async function listMyTasks(userId: string): Promise<MyTask[]> {
  const teams = await Team.find({ 'members.userId': userId }).select('_id name');
  const teamNames = new Map(teams.map((team) => [team._id.toString(), team.name]));

  const tasks = await Task.find({
    assigneeId: new Types.ObjectId(userId),
    teamId: { $in: teams.map((team) => team._id) },
  })
    .sort({ dueDate: 1, createdAt: 1 })
    .limit(300);

  const boards = await Board.find({
    _id: { $in: [...new Set(tasks.map((t) => t.boardId))] },
  }).select('name columns');
  const boardById = new Map(boards.map((board) => [board._id.toString(), board]));

  const dtos = await toTaskDtos(tasks);
  return dtos.map((task) => {
    const board = boardById.get(task.boardId);
    const column = board?.columns.find((entry) => entry._id.toString() === task.columnId);
    return myTaskSchema.parse({
      ...task,
      boardName: board?.name ?? 'Board',
      teamName: teamNames.get(task.teamId) ?? 'Team',
      columnTitle: column?.title ?? 'Unsorted',
      isDone: column?.isDone ?? false,
    });
  });
}
