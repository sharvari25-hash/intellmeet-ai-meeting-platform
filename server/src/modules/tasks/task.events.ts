import {
  SOCKET_EVENTS,
  socketRooms,
  type Task,
  type TaskComment,
  type TaskMoved,
} from '@intellmeet/shared';
import { logger } from '../../lib/logger.js';
import { getIo } from '../../sockets/index.js';
import { createMentionNotifications } from '../notifications/mentions.js';
import { deliverNotifications } from '../notifications/notification.deliver.js';
import { safeCreateNotifications } from '../notifications/notification.service.js';
import { User } from '../users/user.model.js';

/**
 * What happens after a board changes: everyone watching it is told, and
 * anyone the change concerns is notified.
 *
 * Kept apart from the services, like `meeting.notify.ts`: the socket layer
 * imports the board service (to check who may watch a board), so the services
 * reaching back into the socket layer would be a real import cycle. The
 * controllers call these after a write has succeeded.
 *
 * Every broadcast goes to the whole board room, the person who made the
 * change included. Their page already shows it (optimistically, then from
 * the response); the copy is recognised by its `version` and changes nothing.
 * That keeps the server free of "which socket sent this request".
 */

function toBoard(boardId: string, event: string, payload: unknown): void {
  getIo()?.to(socketRooms.board(boardId)).emit(event, payload);
}

export function announceTaskCreated(task: Task): void {
  toBoard(task.boardId, SOCKET_EVENTS.TASK_CREATED, { boardId: task.boardId, task });
}

export function announceTaskUpdated(task: Task): void {
  toBoard(task.boardId, SOCKET_EVENTS.TASK_UPDATED, { boardId: task.boardId, task });
}

export function announceTaskMoved(moved: TaskMoved): void {
  toBoard(moved.boardId, SOCKET_EVENTS.TASK_MOVED, moved);
}

export function announceTaskDeleted(boardId: string, taskId: string): void {
  toBoard(boardId, SOCKET_EVENTS.TASK_DELETED, { boardId, taskId });
}

export function announceComment(input: {
  boardId: string;
  taskId: string;
  comment: TaskComment;
  commentCount: number;
}): void {
  toBoard(input.boardId, SOCKET_EVENTS.TASK_COMMENTED, input);
}

/** Tells a board's viewers to reload it: its columns changed, or tasks went in bulk. */
export function announceBoardRefresh(boardIds: string[]): void {
  for (const boardId of new Set(boardIds)) {
    toBoard(boardId, SOCKET_EVENTS.BOARD_REFRESH, { boardId });
  }
}

/** Where a task notification links to. */
function taskPayload(task: Pick<Task, 'id' | 'boardId' | 'teamId'>) {
  return { taskId: task.id, boardId: task.boardId, teamId: task.teamId };
}

/**
 * Notifies the people these tasks were just given to (`task_assigned`).
 * Assigning a task to yourself notifies nobody. Never throws: the task was
 * saved either way.
 */
export async function notifyAssigned(tasks: Task[], actorId: string): Promise<void> {
  const given = tasks.filter((task) => task.assigneeId && task.assigneeId !== actorId);
  if (given.length === 0) return;

  try {
    const actor = await User.findById(actorId).select('name');
    const created = await safeCreateNotifications(
      given.map((task) => ({
        userId: task.assigneeId as string,
        type: 'task_assigned' as const,
        title: `${actor?.name ?? 'Someone'} assigned you a task`,
        body: task.title.slice(0, 500),
        payload: taskPayload(task),
      })),
    );
    deliverNotifications(getIo(), created);
  } catch (error) {
    logger.error({ err: error }, '[tasks] failed to notify assignees');
  }
}

/** Notifies everyone a task comment mentions. */
export async function notifyCommentMentions(input: {
  text: string;
  authorId: string;
  task: { id: string; title: string };
  boardId: string;
  teamId: string;
}): Promise<void> {
  const created = await createMentionNotifications({
    text: input.text,
    authorId: input.authorId,
    teamId: input.teamId,
    where: `“${input.task.title}”`,
    payload: taskPayload({ id: input.task.id, boardId: input.boardId, teamId: input.teamId }),
  });
  deliverNotifications(getIo(), created);
}
