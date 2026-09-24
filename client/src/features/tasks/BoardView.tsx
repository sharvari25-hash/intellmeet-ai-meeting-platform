import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { GripVertical, Plus } from 'lucide-react';
import { canManageBoards, type BoardDetail, type Task } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { BoardColumn } from './BoardColumn';
import { groupByColumn, neighboursOf } from './boardCache';
import { NameDialog } from './NameDialog';
import { TaskCardBody } from './TaskCard';
import { useColumnActions, useMoveTask } from './useTaskMutations';

type Layout = Record<string, string[]>;

/**
 * The board: columns side by side, cards dragged within and between them.
 *
 * While a card is being dragged, the layout lives in local state, so the
 * card can visit other columns without the cached board changing under it.
 * On drop, the one move is sent as "between these two cards" and applied to
 * the cache optimistically; the local state is dropped and the cache - by
 * then already showing the move - takes over again.
 *
 * On a phone the columns scroll sideways inside the board, one column wide,
 * snapping to each; the page itself never scrolls sideways.
 */
export function BoardView({
  detail,
  onOpenTask,
}: {
  detail: BoardDetail;
  onOpenTask: (task: Task) => void;
}) {
  const { board } = detail;
  const canManage = canManageBoards(board.myRole);
  const move = useMoveTask(board.id);
  const columnActions = useColumnActions(board.id);
  const [addingColumn, setAddingColumn] = useState(false);

  const settled = useMemo<Layout>(() => {
    const grouped = groupByColumn(detail);
    return Object.fromEntries(
      [...grouped].map(([columnId, tasks]) => [columnId, tasks.map((task) => task.id)]),
    );
  }, [detail]);
  const tasksById = useMemo(() => new Map(detail.tasks.map((task) => [task.id, task])), [detail]);

  const [dragLayout, setDragLayout] = useState<Layout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const layout = dragLayout ?? settled;

  const sensors = useSensors(
    // A few pixels of travel before a mouse drag starts, so a click still opens the card.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press on touch, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (state: Layout, id: UniqueIdentifier): string | undefined => {
    const key = String(id);
    if (key in state) return key;
    return Object.keys(state).find((columnId) => state[columnId]?.includes(key));
  };
  const titleOf = (id: UniqueIdentifier) => tasksById.get(String(id))?.title ?? 'The task';
  const columnTitle = (columnId: string | undefined) =>
    board.columns.find((column) => column.id === columnId)?.title ?? 'a column';

  function onDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setDragLayout(settled);
  }

  /** Crossing into another column moves the card into it for the rest of the drag. */
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    setDragLayout((current) => {
      const state = current ?? settled;
      const from = columnOf(state, active.id);
      const to = columnOf(state, over.id);
      if (!from || !to || from === to) return state;

      const id = String(active.id);
      const target = [...(state[to] ?? [])];
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, id);
      return {
        ...state,
        [from]: (state[from] ?? []).filter((entry) => entry !== id),
        [to]: target,
      };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const state = dragLayout ?? settled;
    setActiveId(null);
    setDragLayout(null);
    if (!over) return;

    const id = String(active.id);
    const to = columnOf(state, over.id);
    if (!to) return;

    // Within a column dnd-kit reports the card it was dropped on; reorder to it.
    let ids = state[to] ?? [];
    const from = ids.indexOf(id);
    const onto = ids.indexOf(String(over.id));
    if (from >= 0 && onto >= 0 && from !== onto) ids = arrayMove(ids, from, onto);

    const unchanged = columnOf(settled, id) === to && (settled[to] ?? []).join() === ids.join();
    if (unchanged) return;

    move.mutate({ taskId: id, columnId: to, ...neighboursOf(ids, id) });
  }

  // Read by screen readers as a card moves: names, never ids.
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${titleOf(active.id)}, in ${columnTitle(columnOf(layout, active.id))}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} is over ${columnTitle(columnOf(layout, over.id))}.`
        : `${titleOf(active.id)} is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `${titleOf(active.id)} was dropped in ${columnTitle(columnOf(layout, over.id))}.`
        : `${titleOf(active.id)} was put back.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  function moveColumn(index: number, direction: -1 | 1) {
    const ids = board.columns.map((column) => column.id);
    columnActions.reorder.mutate(arrayMove(ids, index, index + direction));
  }

  const active = activeId ? tasksById.get(activeId) : undefined;
  const activeDone =
    board.columns.find((column) => column.id === active?.columnId)?.isDone ?? false;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setDragLayout(null);
      }}
      accessibility={{ announcements }}
    >
      {/* Full-bleed on a phone, so a column can use the whole width.
          `relative` matters: screen-reader-only text is absolutely
          positioned, and without a positioned ancestor the labels in
          off-screen columns escape this scroller and widen the whole page. */}
      <div className="relative -mx-4 snap-x snap-mandatory overflow-x-auto px-4 pb-3 sm:mx-0 sm:snap-none sm:px-0">
        <div className="flex items-start gap-3">
          {board.columns.map((column, index) => (
            <BoardColumn
              key={column.id}
              boardId={board.id}
              column={column}
              taskIds={layout[column.id] ?? []}
              tasksById={tasksById}
              canManage={canManage}
              isFirst={index === 0}
              isLast={index === board.columns.length - 1}
              onMoveColumn={(direction) => moveColumn(index, direction)}
              onOpenTask={onOpenTask}
            />
          ))}

          {canManage && (
            <Button
              variant="outline"
              className="h-auto w-44 shrink-0 snap-start border-dashed py-3"
              onClick={() => setAddingColumn(true)}
            >
              <Plus aria-hidden="true" />
              Add a column
            </Button>
          )}
        </div>
      </div>

      <DragOverlay>
        {active ? (
          // A picture of the card being dragged; the announcements speak for it.
          <div
            aria-hidden="true"
            className="w-[16rem] rotate-1 rounded-lg border bg-card p-3 shadow-lg sm:w-[17rem]"
          >
            <TaskCardBody
              task={active}
              done={activeDone}
              handle={<GripVertical aria-hidden="true" className="size-4 text-muted-foreground" />}
            />
          </div>
        ) : null}
      </DragOverlay>

      <NameDialog
        open={addingColumn}
        onOpenChange={setAddingColumn}
        title="Add a column"
        description="It goes at the right-hand end. Rename, move or remove it from its menu."
        label="Column name"
        submitLabel="Add column"
        maxLength={40}
        pending={columnActions.add.isPending}
        onSubmit={(title) =>
          columnActions.add.mutate(title, { onSuccess: () => setAddingColumn(false) })
        }
      />
    </DndContext>
  );
}
