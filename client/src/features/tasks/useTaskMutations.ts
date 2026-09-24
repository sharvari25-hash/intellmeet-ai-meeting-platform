import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  Board,
  BoardDetail,
  CreateTaskInput,
  TaskComment,
  UpdateColumnInput,
  UpdateTaskInput,
} from '@intellmeet/shared';
import { applyMoved, moveLocally, removeTask, setCommentCount, upsertTask } from './boardCache';
import * as tasksApi from './tasks.api';
import { taskKeys } from './tasks.api';

/**
 * Every change to a board, as a mutation that edits the cached board with
 * the server's answer - no refetch, so nothing flickers. My Tasks is marked
 * stale by each, and refetches next time it is shown.
 */

function useBoardCache(boardId: string) {
  const queryClient = useQueryClient();
  const key = taskKeys.board(boardId);
  return {
    queryClient,
    key,
    edit: (change: (detail: BoardDetail) => BoardDetail) =>
      queryClient.setQueryData<BoardDetail>(key, (detail) => (detail ? change(detail) : detail)),
    setBoard: (board: Board) =>
      queryClient.setQueryData<BoardDetail>(key, (detail) =>
        detail ? { ...detail, board } : detail,
      ),
    mineIsStale: () => queryClient.invalidateQueries({ queryKey: taskKeys.mine }),
  };
}

export interface MoveArgs {
  taskId: string;
  columnId: string;
  afterId: string | null;
  beforeId: string | null;
}

/**
 * Moves a card, optimistically: it lands where it was dropped at once, and
 * goes back (with a toast saying why) if the server refuses. The server's
 * answer then replaces the guess, which it matches unless somebody else moved
 * something at the same moment.
 */
export function useMoveTask(boardId: string) {
  const cache = useBoardCache(boardId);

  return useMutation({
    mutationFn: ({ taskId, ...where }: MoveArgs) => tasksApi.moveTask(taskId, where),
    onMutate: async (move) => {
      // An in-flight reload finishing now would put the card back where it was.
      await cache.queryClient.cancelQueries({ queryKey: cache.key });
      const previous = cache.queryClient.getQueryData<BoardDetail>(cache.key);
      cache.edit((detail) => moveLocally(detail, move));
      return { previous };
    },
    onError: (error, _move, context) => {
      if (context?.previous) cache.queryClient.setQueryData(cache.key, context.previous);
      // Others may have moved things meanwhile; the server has the truth.
      void cache.queryClient.invalidateQueries({ queryKey: cache.key });
      toast.error(`The task could not be moved. ${error.message}`);
    },
    onSuccess: (moved) => {
      cache.edit((detail) => applyMoved(detail, moved));
      void cache.mineIsStale();
    },
  });
}

export function useCreateTask(boardId: string) {
  const cache = useBoardCache(boardId);
  return useMutation({
    mutationFn: (input: CreateTaskInput) => tasksApi.createTask(boardId, input),
    onSuccess: (task) => {
      cache.edit((detail) => upsertTask(detail, task));
      void cache.mineIsStale();
    },
  });
}

export function useUpdateTask(boardId: string, taskId: string) {
  const cache = useBoardCache(boardId);
  return useMutation({
    mutationFn: (input: UpdateTaskInput) => tasksApi.updateTask(taskId, input),
    onSuccess: (task) => {
      cache.edit((detail) => upsertTask(detail, task));
      void cache.mineIsStale();
      toast.success('Saved');
    },
  });
}

export function useDeleteTask(boardId: string, taskId: string) {
  const cache = useBoardCache(boardId);
  return useMutation({
    mutationFn: () => tasksApi.deleteTask(taskId),
    onSuccess: () => {
      cache.edit((detail) => removeTask(detail, taskId));
      void cache.mineIsStale();
      toast.success('Task deleted');
    },
  });
}

export function useAddComment(boardId: string, taskId: string) {
  const cache = useBoardCache(boardId);
  return useMutation({
    mutationFn: (text: string) => tasksApi.addComment(taskId, text),
    onSuccess: ({ comment, commentCount }) => {
      cache.edit((detail) => setCommentCount(detail, taskId, commentCount));
      cache.queryClient.setQueryData<TaskComment[]>(taskKeys.comments(taskId), (comments) =>
        comments && !comments.some((entry) => entry.id === comment.id)
          ? [...comments, comment]
          : comments,
      );
    },
  });
}

/** Column changes answer with the board; its tasks are untouched. */
export function useColumnActions(boardId: string) {
  const cache = useBoardCache(boardId);
  const onSuccess = ({ board }: { board: Board }) => cache.setBoard(board);
  const onError = (error: Error) => toast.error(error.message);

  return {
    add: useMutation({
      mutationFn: (title: string) => tasksApi.addColumn(boardId, title),
      onSuccess,
      onError,
    }),
    update: useMutation({
      mutationFn: ({ columnId, input }: { columnId: string; input: UpdateColumnInput }) =>
        tasksApi.updateColumn(boardId, columnId, input),
      onSuccess,
      onError,
    }),
    remove: useMutation({
      mutationFn: (columnId: string) => tasksApi.deleteColumn(boardId, columnId),
      onSuccess,
      onError,
    }),
    reorder: useMutation({
      mutationFn: (columnIds: string[]) => tasksApi.reorderColumns(boardId, columnIds),
      onSuccess,
      onError,
    }),
  };
}
