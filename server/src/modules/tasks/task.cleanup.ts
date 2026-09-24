import type { Types } from 'mongoose';
import { MeetingInsight } from '../ai/insight.model.js';
import { Notification } from '../notifications/notification.model.js';
import { TaskComment } from './comment.model.js';
import { Task } from './task.model.js';

/**
 * Removing tasks, and everything that points at them.
 *
 * One function for every path that deletes tasks - a person deleting one, a
 * board or team going, a demo guest leaving, the stale-demo sweep - so none of
 * them can forget a collection: the comments, the action item that says "this
 * has a task", and notifications that would link to a task that is gone.
 */

export interface TaskDeletion {
  tasks: number;
  /** Boards that lost tasks, so their viewers can be told to reload. */
  boardIds: string[];
}

/**
 * Deletes the tasks matching `filter`.
 *
 * **Seeded sample tasks are never matched** unless `includeSeeded` is set,
 * which only deleting a whole board does (and the seeded board belongs to the
 * seeded team, which nothing deletes). That default is the guarantee the demo
 * cleanup relies on.
 */
export async function deleteTasksWhere(
  filter: Record<string, unknown>,
  options: { includeSeeded?: boolean } = {},
): Promise<TaskDeletion> {
  const where = options.includeSeeded ? filter : { ...filter, seeded: { $ne: true } };
  const doomed = await Task.find(where).select('_id boardId');
  if (doomed.length === 0) return { tasks: 0, boardIds: [] };

  const ids = doomed.map((task) => task._id);

  // Children first: a crash halfway leaves tasks without comments, never
  // comments pointing at a task that no longer resolves.
  await TaskComment.deleteMany({ taskId: { $in: ids } });
  await unlinkActionItems(ids);
  // Payloads are free-form JSON, with ids as strings.
  await Notification.deleteMany({ 'payload.taskId': { $in: ids.map((id) => id.toString()) } });

  const { deletedCount } = await Task.deleteMany({ _id: { $in: ids } });

  return {
    tasks: deletedCount,
    boardIds: [...new Set(doomed.map((task) => task.boardId.toString()))],
  };
}

/**
 * Forgets the task on any action item that pointed at these tasks, so the
 * meeting page offers "Create task" for the item again.
 */
export async function unlinkActionItems(taskIds: Types.ObjectId[]): Promise<void> {
  if (taskIds.length === 0) return;
  await MeetingInsight.updateMany(
    { 'actionItems.taskId': { $in: taskIds } },
    { $set: { 'actionItems.$[linked].taskId': null } },
    { arrayFilters: [{ 'linked.taskId': { $in: taskIds } }] },
  );
}
