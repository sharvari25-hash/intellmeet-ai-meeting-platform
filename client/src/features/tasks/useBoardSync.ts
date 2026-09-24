import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  SOCKET_EVENTS,
  type BoardDetail,
  type TaskComment,
  type TaskCommentedEvent,
  type TaskDeletedEvent,
  type TaskEvent,
  type TaskMoved,
} from '@intellmeet/shared';
import { useSocketStore } from '@/stores/socketStore';
import { applyMoved, removeTask, setCommentCount, upsertTask } from './boardCache';
import { taskKeys } from './tasks.api';

/**
 * Keeps a board live: joins its socket room while the board is on screen and
 * applies what everyone else does to the cached board.
 *
 * Events are applied to the cache rather than triggering a refetch. A drag in
 * another window is one small event, and refetching the whole board for each
 * would make two people moving cards at once visibly laggy. Only changes too
 * broad to describe task by task (columns, a reset, a guest leaving) ask for
 * a reload.
 *
 * Our own changes come back too. They are recognised by their version and
 * change nothing (see `upsertTask`).
 */
export function useBoardSync(boardId: string | null): void {
  const socket = useSocketStore((state) => state.socket);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket || !boardId) return;

    const key = taskKeys.board(boardId);
    const edit = (change: (detail: BoardDetail) => BoardDetail) =>
      queryClient.setQueryData<BoardDetail>(key, (detail) => (detail ? change(detail) : detail));
    const mine = (payload: { boardId: string }) => payload.boardId === boardId;

    const onTask = (raw: unknown) => {
      const event = raw as TaskEvent;
      if (mine(event)) edit((detail) => upsertTask(detail, event.task));
    };
    const onMoved = (raw: unknown) => {
      const event = raw as TaskMoved;
      if (mine(event)) edit((detail) => applyMoved(detail, event));
    };
    const onDeleted = (raw: unknown) => {
      const event = raw as TaskDeletedEvent;
      if (mine(event)) edit((detail) => removeTask(detail, event.taskId));
    };
    const onCommented = (raw: unknown) => {
      const event = raw as TaskCommentedEvent;
      if (!mine(event)) return;
      edit((detail) => setCommentCount(detail, event.taskId, event.commentCount));
      // An open task shows the new comment straight away.
      queryClient.setQueryData<TaskComment[]>(taskKeys.comments(event.taskId), (comments) =>
        comments && !comments.some((comment) => comment.id === event.comment.id)
          ? [...comments, event.comment]
          : comments,
      );
    };
    const onRefresh = (raw: unknown) => {
      if (mine(raw as { boardId: string })) void queryClient.invalidateQueries({ queryKey: key });
    };

    const join = () => socket.emit(SOCKET_EVENTS.BOARD_JOIN, { boardId });
    // A reconnected socket is in no rooms, and missed whatever happened while
    // it was away: rejoin, then reload once to catch up.
    const onReconnect = () => {
      join();
      void queryClient.invalidateQueries({ queryKey: key });
    };

    socket.on(SOCKET_EVENTS.TASK_CREATED, onTask);
    socket.on(SOCKET_EVENTS.TASK_UPDATED, onTask);
    socket.on(SOCKET_EVENTS.TASK_MOVED, onMoved);
    socket.on(SOCKET_EVENTS.TASK_DELETED, onDeleted);
    socket.on(SOCKET_EVENTS.TASK_COMMENTED, onCommented);
    socket.on(SOCKET_EVENTS.BOARD_REFRESH, onRefresh);
    socket.on('connect', onReconnect);
    join();

    return () => {
      socket.off(SOCKET_EVENTS.TASK_CREATED, onTask);
      socket.off(SOCKET_EVENTS.TASK_UPDATED, onTask);
      socket.off(SOCKET_EVENTS.TASK_MOVED, onMoved);
      socket.off(SOCKET_EVENTS.TASK_DELETED, onDeleted);
      socket.off(SOCKET_EVENTS.TASK_COMMENTED, onCommented);
      socket.off(SOCKET_EVENTS.BOARD_REFRESH, onRefresh);
      socket.off('connect', onReconnect);
      socket.emit(SOCKET_EVENTS.BOARD_LEAVE, { boardId });
    };
  }, [socket, boardId, queryClient]);
}
