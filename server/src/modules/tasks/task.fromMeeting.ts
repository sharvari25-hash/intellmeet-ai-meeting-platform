import { Types } from 'mongoose';
import {
  ORDER_STEP,
  type CreateTasksFromActionItemsInput,
  type FieldIssue,
  type MeetingIntelligence,
  type Task as TaskDto,
} from '@intellmeet/shared';
import { AppError } from '../../lib/errors.js';
import { getMeetingIntelligence } from '../ai/ai.service.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { getMeetingForMember } from '../meetings/meeting.service.js';
import { Team } from '../teams/team.model.js';
import {
  ensureDefaultBoard,
  getBoardForMember,
  isDuplicateKeyError,
  touchBoards,
} from './board.service.js';
import { Task } from './task.model.js';
import { assertBoardCapacity, bottomOfColumn, toTaskDtos } from './task.service.js';

/** Pipeline steps during which the insight is about to be replaced. */
const IN_PROGRESS = ['queued', 'transcribing', 'summarizing'];

export interface TasksFromMeetingResult {
  tasks: TaskDto[];
  /** Items that already had a task (a double click, or somebody else got there first). */
  skipped: string[];
  intelligence: MeetingIntelligence;
}

/**
 * Turns a meeting's action items into tasks, one or many at once.
 *
 * Any member of the meeting's team may do it - filing the tasks is often not
 * the host's job - but only for that team's boards. Each task keeps a link to
 * its meeting and item, and the item a link to its task, so the meeting page
 * can show where each one is on the board and a second "Create task" cannot
 * duplicate it. The unique index on (meeting, item) is what actually
 * guarantees that when two people press it at the same moment.
 *
 * The owner and deadline arrive pre-filled from the AI's reading, and may
 * have been changed in the dialog. Tasks go to the bottom of the board's
 * first column, in the order the items are listed.
 */
export async function createTasksFromActionItems(
  meetingId: string,
  userId: string,
  input: CreateTasksFromActionItemsInput,
): Promise<TasksFromMeetingResult> {
  const meeting = await getMeetingForMember(meetingId, userId);

  if (IN_PROGRESS.includes(meeting.aiStatus)) {
    throw AppError.conflict(
      'The action items are still being generated. Try again once they are ready.',
    );
  }

  const insight = await MeetingInsight.findOne({ meetingId: meeting._id }).lean();
  if (!insight) throw AppError.notFound('This meeting has no action items yet');

  // Items stored before they had ids (Phase 6) are shown as `legacy-N`. They
  // get real ids now, so a task has something stable to point at.
  const items = insight.actionItems.some((item) => !item._id)
    ? await assignItemIds(insight._id, insight.actionItems)
    : insight.actionItems;
  const idOf = (index: number) => items[index]?._id?.toString() ?? '';

  const board = input.boardId
    ? (await getBoardForMember(input.boardId, userId)).board
    : await ensureDefaultBoard(meeting.teamId, userId);
  if (!board.teamId.equals(meeting.teamId)) {
    throw AppError.validation([
      { path: 'body.boardId', message: 'Choose a board of the meeting’s own team' },
    ]);
  }

  const team = await Team.findById(meeting.teamId).select('members.userId');
  const members = new Set(team?.members.map((member) => member.userId.toString()) ?? []);

  // Resolve every requested item first, and report all problems at once.
  const issues: FieldIssue[] = [];
  const existingTasks = new Set(
    (
      await Task.find({
        _id: { $in: items.flatMap((item) => (item.taskId ? [item.taskId] : [])) },
      }).select('_id')
    ).map((task) => task._id.toString()),
  );

  const skipped: string[] = [];
  const wanted = input.items.flatMap((request, index) => {
    const position = request.actionItemId.startsWith('legacy-')
      ? Number(request.actionItemId.slice('legacy-'.length))
      : items.findIndex((item) => item._id?.toString() === request.actionItemId);
    const item = Number.isInteger(position) ? items[position] : undefined;

    if (!item) {
      issues.push({ path: `body.items.${index}.actionItemId`, message: 'No such action item' });
      return [];
    }
    if (request.assigneeId && !members.has(request.assigneeId)) {
      issues.push({
        path: `body.items.${index}.assigneeId`,
        message: 'Tasks can only be assigned to members of this team',
      });
      return [];
    }
    if (item.taskId && existingTasks.has(item.taskId.toString())) {
      skipped.push(request.actionItemId);
      return [];
    }
    return [{ request, item, itemId: idOf(position) }];
  });
  if (issues.length > 0) throw AppError.validation(issues);

  await assertBoardCapacity(board._id, wanted.length);

  const firstColumn = board.columns[0];
  if (!firstColumn) throw AppError.conflict('That board has no columns');
  let order = await bottomOfColumn(board._id, firstColumn._id);

  const created = [];
  for (const { request, item, itemId } of wanted) {
    try {
      const task = await Task.create({
        boardId: board._id,
        teamId: board.teamId,
        columnId: firstColumn._id,
        title: item.text.slice(0, 200),
        description: '',
        assigneeId: request.assigneeId ? new Types.ObjectId(request.assigneeId) : null,
        dueDate: request.dueDate,
        priority: request.priority ?? 'medium',
        order,
        sourceMeetingId: meeting._id,
        sourceActionItemId: new Types.ObjectId(itemId),
        createdBy: new Types.ObjectId(userId),
      });
      order += ORDER_STEP;
      created.push(task);
    } catch (error) {
      // Somebody created this item's task in the same instant.
      if (isDuplicateKeyError(error)) {
        skipped.push(request.actionItemId);
        continue;
      }
      throw error;
    }
  }

  if (created.length > 0) {
    await MeetingInsight.bulkWrite(
      created.map((task) => ({
        updateOne: {
          filter: { _id: insight._id },
          update: { $set: { 'actionItems.$[item].taskId': task._id } },
          arrayFilters: [{ 'item._id': task.sourceActionItemId }],
        },
      })),
    );
    await touchBoards([board._id]);
  }

  return {
    tasks: await toTaskDtos(created),
    skipped,
    intelligence: await getMeetingIntelligence(meetingId, userId),
  };
}

/** Gives every action item without an `_id` a real one, keeping their order. */
async function assignItemIds<T extends { _id?: Types.ObjectId }>(
  insightId: Types.ObjectId,
  items: T[],
): Promise<(T & { _id: Types.ObjectId })[]> {
  const withIds = items.map((item) => ({ ...item, _id: item._id ?? new Types.ObjectId() }));
  await MeetingInsight.updateOne({ _id: insightId }, { $set: { actionItems: withIds } });
  return withIds;
}
