import { Types } from 'mongoose';
import {
  DEFAULT_COLUMNS,
  MAX_COLUMNS,
  boardSchema,
  boardSummarySchema,
  canManageBoards,
  type Board as BoardDto,
  type BoardSummary,
  type CreateBoardInput,
  type TeamRole,
  type UpdateColumnInput,
} from '@intellmeet/shared';
import { AppError } from '../../lib/errors.js';
import { Team, type TeamDocument } from '../teams/team.model.js';
import { Board, type BoardDocument } from './board.model.js';
import { Task } from './task.model.js';
import { deleteTasksWhere } from './task.cleanup.js';

export interface BoardAccess {
  board: BoardDocument;
  team: TeamDocument;
  role: TeamRole;
}

/** MongoDB reports a unique-index violation with code 11000. */
export function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

function roleIn(team: TeamDocument, userId: string): TeamRole | undefined {
  return team.members.find((member) => member.userId.toString() === userId)?.role;
}

/**
 * The team, if the user belongs to it. A non-member gets 404, never 403: that
 * would confirm another tenant's team exists (the rule every module follows).
 */
export async function getTeamForMember(
  teamId: string,
  userId: string,
): Promise<{ team: TeamDocument; role: TeamRole }> {
  const team = await Team.findById(teamId).select('name members');
  const role = team ? roleIn(team, userId) : undefined;
  if (!team || !role) throw AppError.notFound('Team not found');
  return { team, role };
}

/**
 * Loads a board the user may see: a member of its team. Every board and task
 * operation starts here, so none can forget the check.
 */
export async function getBoardForMember(boardId: string, userId: string): Promise<BoardAccess> {
  const board = await Board.findById(boardId);
  if (!board) throw AppError.notFound('Board not found');

  const team = await Team.findById(board.teamId).select('name members');
  const role = team ? roleIn(team, userId) : undefined;
  if (!team || !role) throw AppError.notFound('Board not found');

  return { board, team, role };
}

/** Same, for changes to the board itself, which are a team admin's. */
export async function getBoardForAdmin(boardId: string, userId: string): Promise<BoardAccess> {
  const access = await getBoardForMember(boardId, userId);
  if (!canManageBoards(access.role)) {
    throw AppError.forbidden('Only a team admin can change boards and columns');
  }
  return access;
}

export function toBoardSummary(board: BoardDocument): BoardSummary {
  return boardSummarySchema.parse({
    id: board._id.toString(),
    teamId: board.teamId.toString(),
    name: board.name,
    isDefault: board.isDefault,
  });
}

export function toBoardDto(board: BoardDocument, team: TeamDocument, role: TeamRole): BoardDto {
  return boardSchema.parse({
    ...toBoardSummary(board),
    teamName: team.name,
    columns: board.columns.map((column) => ({
      id: column._id.toString(),
      title: column.title,
      isDone: column.isDone ?? false,
    })),
    seeded: board.seeded ?? false,
    myRole: role,
    createdAt: board.createdAt.toISOString(),
  });
}

function defaultColumns() {
  return DEFAULT_COLUMNS.map((column) => ({ title: column.title, isDone: column.isDone }));
}

/**
 * The team's default board, created on first use.
 *
 * Lazily, rather than when a team is created, so every team that existed
 * before boards did gets one too. Two first visits at the same moment race;
 * the partial unique index lets exactly one insert through, and the loser
 * reads the winner's board.
 */
export async function ensureDefaultBoard(
  teamId: string | Types.ObjectId,
  createdBy: string | null = null,
): Promise<BoardDocument> {
  const existing = await Board.findOne({ teamId, isDefault: true });
  if (existing) return existing;

  try {
    return await Board.create({
      teamId,
      name: 'Team board',
      isDefault: true,
      columns: defaultColumns(),
      createdBy,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const winner = await Board.findOne({ teamId, isDefault: true });
      if (winner) return winner;
    }
    throw error;
  }
}

/** A team's boards, the default first. Creates the default one if needed. */
export async function listBoards(teamId: string, userId: string): Promise<BoardSummary[]> {
  await getTeamForMember(teamId, userId);
  await ensureDefaultBoard(teamId, userId);

  const boards = await Board.find({ teamId }).sort({ isDefault: -1, createdAt: 1 });
  return boards.map(toBoardSummary);
}

export async function createBoard(input: CreateBoardInput, userId: string): Promise<BoardDto> {
  const { team, role } = await getTeamForMember(input.teamId, userId);
  if (!canManageBoards(role)) throw AppError.forbidden('Only a team admin can create boards');

  // Made first, so a team's first extra board never also becomes its default.
  await ensureDefaultBoard(input.teamId, userId);

  const board = await Board.create({
    teamId: team._id,
    name: input.name,
    columns: defaultColumns(),
    createdBy: new Types.ObjectId(userId),
  });
  return toBoardDto(board, team, role);
}

export async function getBoardDto(boardId: string, userId: string): Promise<BoardDto> {
  const { board, team, role } = await getBoardForMember(boardId, userId);
  return toBoardDto(board, team, role);
}

export async function renameBoard(
  boardId: string,
  userId: string,
  name: string,
): Promise<BoardDto> {
  const { board, team, role } = await getBoardForAdmin(boardId, userId);
  board.name = name;
  await board.save();
  return toBoardDto(board, team, role);
}

/** Deletes a board with its tasks. The default board stays: meetings send tasks there. */
export async function deleteBoard(boardId: string, userId: string): Promise<void> {
  const { board } = await getBoardForAdmin(boardId, userId);
  if (board.isDefault) {
    throw AppError.conflict('The team’s main board cannot be deleted');
  }

  await deleteTasksWhere({ boardId: board._id }, { includeSeeded: true });
  await board.deleteOne();
}

// --- Columns -------------------------------------------------------------------

export async function addColumn(boardId: string, userId: string, title: string): Promise<BoardDto> {
  const { board, team, role } = await getBoardForAdmin(boardId, userId);
  if (board.columns.length >= MAX_COLUMNS) {
    throw AppError.conflict(`A board can have at most ${MAX_COLUMNS} columns`);
  }

  board.columns.push({ title, isDone: false });
  await board.save();
  return toBoardDto(board, team, role);
}

function findColumn(board: BoardDocument, columnId: string) {
  const column = board.columns.find((entry) => entry._id.toString() === columnId);
  if (!column) throw AppError.notFound('Column not found');
  return column;
}

export async function updateColumn(
  boardId: string,
  columnId: string,
  userId: string,
  input: UpdateColumnInput,
): Promise<BoardDto> {
  const { board, team, role } = await getBoardForAdmin(boardId, userId);
  const column = findColumn(board, columnId);

  if (input.title !== undefined) column.title = input.title;
  if (input.isDone !== undefined) column.isDone = input.isDone;
  await board.save();

  return toBoardDto(board, team, role);
}

/**
 * Removes an empty column. One with tasks in it is refused rather than taking
 * them with it or moving them somewhere the admin did not choose.
 */
export async function deleteColumn(
  boardId: string,
  columnId: string,
  userId: string,
): Promise<BoardDto> {
  const { board, team, role } = await getBoardForAdmin(boardId, userId);
  const column = findColumn(board, columnId);

  if (board.columns.length <= 1) throw AppError.conflict('A board needs at least one column');
  if (await Task.exists({ boardId: board._id, columnId: column._id })) {
    throw AppError.conflict('Move the tasks out of this column before removing it');
  }

  board.columns.pull({ _id: column._id });
  await board.save();
  return toBoardDto(board, team, role);
}

/**
 * Puts the columns in a new order, given as the complete list of ids. Refused
 * unless it is exactly the current set, so a client with a stale board cannot
 * drop a column somebody else just added.
 */
export async function reorderColumns(
  boardId: string,
  userId: string,
  columnIds: string[],
): Promise<BoardDto> {
  const { board, team, role } = await getBoardForAdmin(boardId, userId);

  const current = board.columns.map((column) => column._id.toString());
  const sameSet =
    columnIds.length === current.length &&
    new Set(columnIds).size === columnIds.length &&
    columnIds.every((id) => current.includes(id));
  if (!sameSet) {
    throw AppError.conflict('The board’s columns have changed. Reload and try again.');
  }

  const byId = new Map(board.columns.map((column) => [column._id.toString(), column.toObject()]));
  board.set(
    'columns',
    columnIds.map((id) => byId.get(id)),
  );
  await board.save();
  return toBoardDto(board, team, role);
}

/** Notes that a task on this board changed, for the demo board's idle reset. */
export async function touchBoards(boardIds: (string | Types.ObjectId)[]): Promise<void> {
  if (boardIds.length === 0) return;
  await Board.updateMany({ _id: { $in: boardIds } }, { $set: { activityAt: new Date() } });
}
