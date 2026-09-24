import { orderBetween, type BoardDetail, type Task, type TaskMoved } from '@intellmeet/shared';

/**
 * Pure edits to a cached board (`['boards', id]`).
 *
 * The board is one cache entry, edited in place by three sources: this tab's
 * own moves (optimistically, before the server answers), the server's answers,
 * and other people's changes arriving over the socket. Those can land in any
 * order, so every task carries a `version` and an older copy never replaces
 * a newer one. Kept free of React so each rule can be tested on its own.
 */

/** Top to bottom; the id breaks a tie, the same way the server sorts. */
export function byOrder(a: Task, b: Task): number {
  return a.order - b.order || a.id.localeCompare(b.id);
}

/**
 * Each column's tasks, in order, keyed by column id. A task in a column the
 * board no longer has (removed a moment ago by an admin) shows in the first
 * one rather than vanishing.
 */
export function groupByColumn(detail: BoardDetail): Map<string, Task[]> {
  const groups = new Map<string, Task[]>(detail.board.columns.map((column) => [column.id, []]));
  const first = detail.board.columns[0]?.id;

  for (const task of detail.tasks) {
    const key = groups.has(task.columnId) ? task.columnId : first;
    if (key) groups.get(key)?.push(task);
  }
  for (const tasks of groups.values()) tasks.sort(byOrder);
  return groups;
}

/** A task from the server: added if new, replaced if at least as new as ours. */
export function upsertTask(detail: BoardDetail, task: Task): BoardDetail {
  const existing = detail.tasks.find((entry) => entry.id === task.id);
  if (!existing) return { ...detail, tasks: [...detail.tasks, task] };
  if (existing.version > task.version) return detail;
  return { ...detail, tasks: detail.tasks.map((entry) => (entry.id === task.id ? task : entry)) };
}

/** A move from the server, with any tasks it had to renumber. */
export function applyMoved(detail: BoardDetail, moved: TaskMoved): BoardDetail {
  const next = upsertTask(detail, moved.task);
  if (moved.reordered.length === 0) return next;

  const orders = new Map(moved.reordered.map((entry) => [entry.id, entry.order]));
  return {
    ...next,
    tasks: next.tasks.map((task) => {
      const order = orders.get(task.id);
      return order === undefined ? task : { ...task, order };
    }),
  };
}

export function removeTask(detail: BoardDetail, taskId: string): BoardDetail {
  return { ...detail, tasks: detail.tasks.filter((task) => task.id !== taskId) };
}

export function setCommentCount(detail: BoardDetail, taskId: string, count: number): BoardDetail {
  return {
    ...detail,
    tasks: detail.tasks.map((task) =>
      task.id === taskId ? { ...task, commentCount: count } : task,
    ),
  };
}

/**
 * What the server needs to know about a drop: the cards either side of it,
 * from the column's ids in their new order (the moved one included).
 */
export function neighboursOf(
  ids: readonly string[],
  taskId: string,
): { afterId: string | null; beforeId: string | null } {
  const index = ids.indexOf(taskId);
  if (index === -1) return { afterId: null, beforeId: null };
  return {
    afterId: index > 0 ? (ids[index - 1] ?? null) : null,
    beforeId: ids[index + 1] ?? null,
  };
}

/**
 * The move, shown before the server has answered.
 *
 * Uses the same `orderBetween` as the server, so when the answer arrives the
 * card is already where it lands and nothing jumps. When the gap between the
 * neighbours has run out the server renumbers the column; here the midpoint
 * is close enough to show until then. The version is left alone: the answer
 * carries the real one.
 */
export function moveLocally(
  detail: BoardDetail,
  move: { taskId: string; columnId: string; afterId: string | null; beforeId: string | null },
): BoardDetail {
  const orderOf = (id: string | null) =>
    id ? (detail.tasks.find((task) => task.id === id)?.order ?? null) : null;
  const previous = orderOf(move.afterId);
  const next = orderOf(move.beforeId);
  const order = orderBetween(previous, next) ?? ((previous ?? 0) + (next ?? 0)) / 2;

  return {
    ...detail,
    tasks: detail.tasks.map((task) =>
      task.id === move.taskId ? { ...task, columnId: move.columnId, order } : task,
    ),
  };
}
