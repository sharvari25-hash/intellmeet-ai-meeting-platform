import { z } from 'zod';
import {
  boardDetailSchema,
  boardSchema,
  boardSummarySchema,
  meetingIntelligenceSchema,
  myTaskListSchema,
  taskCommentListSchema,
  taskCommentSchema,
  taskMovedSchema,
  taskSchema,
  type BoardDetail,
  type BoardSummary,
  type CreateTaskInput,
  type CreateTasksFromActionItemsInput,
  type MoveTaskInput,
  type MyTask,
  type Task,
  type TaskComment,
  type TaskMoved,
  type UpdateColumnInput,
  type UpdateTaskInput,
} from '@intellmeet/shared';
import { api, apiVoid } from '@/lib/apiClient';

/**
 * Query keys. A board and everything on it is one cache entry,
 * `['boards', id]`: moves and real-time events edit it in place, and a reload
 * replaces it whole.
 */
export const taskKeys = {
  boards: (teamId: string) => ['boards', 'team', teamId] as const,
  board: (boardId: string) => ['boards', boardId] as const,
  comments: (taskId: string) => ['tasks', taskId, 'comments'] as const,
  mine: ['tasks', 'mine'] as const,
};

const boardsResponse = z.object({ boards: z.array(boardSummarySchema) });
const boardResponse = z.object({ board: boardSchema });
const taskResponse = z.object({ task: taskSchema });
const commentResponse = z.object({
  comment: taskCommentSchema,
  commentCount: z.number().int().nonnegative(),
});
const fromMeetingResponse = z.object({
  tasks: z.array(taskSchema),
  skipped: z.array(z.string()),
  intelligence: meetingIntelligenceSchema,
});
export type TasksFromMeeting = z.infer<typeof fromMeetingResponse>;

export function listBoards(teamId: string): Promise<BoardSummary[]> {
  return api(`/boards?teamId=${teamId}`, boardsResponse).then((result) => result.boards);
}

export function getBoard(boardId: string): Promise<BoardDetail> {
  return api(`/boards/${boardId}`, boardDetailSchema);
}

export function createBoard(teamId: string, name: string) {
  return api('/boards', boardResponse, { method: 'POST', body: { teamId, name } }).then(
    (result) => result.board,
  );
}

export function addColumn(boardId: string, title: string) {
  return api(`/boards/${boardId}/columns`, boardResponse, { method: 'POST', body: { title } });
}

export function updateColumn(boardId: string, columnId: string, input: UpdateColumnInput) {
  return api(`/boards/${boardId}/columns/${columnId}`, boardResponse, {
    method: 'PATCH',
    body: input,
  });
}

export function deleteColumn(boardId: string, columnId: string) {
  return api(`/boards/${boardId}/columns/${columnId}`, boardResponse, { method: 'DELETE' });
}

export function reorderColumns(boardId: string, columnIds: string[]) {
  return api(`/boards/${boardId}/columns`, boardResponse, {
    method: 'PUT',
    body: { columnIds },
  });
}

export function createTask(boardId: string, input: CreateTaskInput): Promise<Task> {
  return api(`/boards/${boardId}/tasks`, taskResponse, { method: 'POST', body: input }).then(
    (result) => result.task,
  );
}

export function updateTask(taskId: string, input: UpdateTaskInput): Promise<Task> {
  return api(`/tasks/${taskId}`, taskResponse, { method: 'PATCH', body: input }).then(
    (result) => result.task,
  );
}

export function moveTask(taskId: string, input: MoveTaskInput): Promise<TaskMoved> {
  return api(`/tasks/${taskId}/move`, taskMovedSchema, { method: 'POST', body: input });
}

export function deleteTask(taskId: string): Promise<void> {
  return apiVoid(`/tasks/${taskId}`, { method: 'DELETE' });
}

export function listComments(taskId: string): Promise<TaskComment[]> {
  return api(`/tasks/${taskId}/comments`, taskCommentListSchema).then((result) => result.comments);
}

export function addComment(taskId: string, text: string) {
  return api(`/tasks/${taskId}/comments`, commentResponse, { method: 'POST', body: { text } });
}

export function listMyTasks(): Promise<MyTask[]> {
  return api('/tasks/mine', myTaskListSchema).then((result) => result.tasks);
}

/** Action items into tasks, one or many. Answers with the meeting's updated intelligence. */
export function createTasksFromActionItems(
  meetingId: string,
  input: CreateTasksFromActionItemsInput,
): Promise<TasksFromMeeting> {
  return api(`/meetings/${meetingId}/tasks`, fromMeetingResponse, { method: 'POST', body: input });
}

/** Where a task opens: its board, with the task's dialog. */
export function taskPath(task: { id: string; boardId: string }): string {
  return `/app/tasks?board=${task.boardId}&task=${task.id}`;
}
