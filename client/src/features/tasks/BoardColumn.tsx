import { useId, useRef, useState, type FormEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { BoardColumn as Column, Task } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/features/auth/FormError';
import { cn } from '@/lib/utils';
import { NameDialog } from './NameDialog';
import { TaskCard } from './TaskCard';
import { useColumnActions, useCreateTask } from './useTaskMutations';

interface Props {
  boardId: string;
  column: Column;
  /** Ids in display order: the live drag state while dragging. */
  taskIds: string[];
  tasksById: Map<string, Task>;
  canManage: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMoveColumn: (direction: -1 | 1) => void;
  onOpenTask: (task: Task) => void;
}

/**
 * One column: its cards, a way to add one, and - for a team admin - the
 * column's own options. The list is a drop target even when empty, which is
 * what lets a card land in a column with nothing in it.
 */
export function BoardColumn({
  boardId,
  column,
  taskIds,
  tasksById,
  canManage,
  isFirst,
  isLast,
  onMoveColumn,
  onOpenTask,
}: Props) {
  const headingId = useId();
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { type: 'column' } });

  return (
    <section
      aria-labelledby={headingId}
      data-column-id={column.id}
      className="flex max-h-[calc(100dvh-14rem)] min-h-40 w-[17rem] shrink-0 snap-start flex-col rounded-xl border bg-muted/40 sm:w-72"
    >
      <header className="flex items-center gap-2 px-3 pb-1 pt-3">
        <h2 id={headingId} className="min-w-0 truncate text-sm font-semibold">
          {column.title}
        </h2>
        <Badge variant="secondary" className="px-1.5">
          {taskIds.length}
          <span className="sr-only"> {taskIds.length === 1 ? 'task' : 'tasks'}</span>
        </Badge>
        {column.isDone && (
          <CheckCircle2
            aria-label="Tasks here count as done"
            className="size-4 shrink-0 text-[var(--success)]"
          />
        )}
        {canManage && (
          <ColumnMenu
            boardId={boardId}
            column={column}
            empty={taskIds.length === 0}
            isFirst={isFirst}
            isLast={isLast}
            onMove={onMoveColumn}
          />
        )}
      </header>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          aria-label={`${column.title} tasks`}
          className={cn(
            'min-h-16 flex-1 space-y-2 overflow-y-auto rounded-lg p-2 transition-colors',
            isOver && 'bg-accent/60',
          )}
        >
          {taskIds.map((id) => {
            const task = tasksById.get(id);
            return task ? (
              <TaskCard key={id} task={task} done={column.isDone} onOpen={onOpenTask} />
            ) : null;
          })}
        </ul>
      </SortableContext>

      <AddTask boardId={boardId} column={column} />
    </section>
  );
}

/** "+ Add a task" at the foot of a column: a title, then Enter. */
function AddTask({ boardId, column }: { boardId: string; column: Column }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateTask(boardId);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), columnId: column.id },
      {
        onSuccess: () => {
          // Stay open for the next one: people add tasks in runs.
          setTitle('');
          inputRef.current?.focus();
        },
      },
    );
  }

  if (!open) {
    return (
      <div className="p-2 pt-0">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Plus aria-hidden="true" />
          Add a task
          <span className="sr-only"> to {column.title}</span>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2 p-2 pt-0">
      <Label htmlFor={inputId} className="sr-only">
        New task in {column.title}
      </Label>
      <Input
        id={inputId}
        ref={inputRef}
        value={title}
        autoFocus
        maxLength={200}
        placeholder="What needs doing?"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            setTitle('');
          }
        }}
      />
      <FormError error={create.error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending || !title.trim()}>
          {create.isPending && <Spinner label="Adding" />}
          Add task
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setTitle('');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A team admin's options for one column. */
function ColumnMenu({
  boardId,
  column,
  empty,
  isFirst,
  isLast,
  onMove,
}: {
  boardId: string;
  column: Column;
  empty: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (direction: -1 | 1) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const actions = useColumnActions(boardId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto size-7"
            aria-label={`Options for the ${column.title} column`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              actions.update.mutate({ columnId: column.id, input: { isDone: !column.isDone } })
            }
          >
            <CheckCircle2 aria-hidden="true" />
            {column.isDone ? 'Stop counting as done' : 'Count tasks here as done'}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isFirst} onSelect={() => onMove(-1)}>
            <ArrowLeft aria-hidden="true" />
            Move left
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isLast} onSelect={() => onMove(1)}>
            <ArrowRight aria-hidden="true" />
            Move right
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Only an empty column can go: the server refuses otherwise, and
              saying so here is better than an error after the fact. */}
          <DropdownMenuItem
            disabled={!empty}
            onSelect={() => actions.remove.mutate(column.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 aria-hidden="true" />
            {empty ? 'Remove column' : 'Remove column (move its tasks first)'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename column"
        description="Everyone on the board sees the new name straight away."
        label="Column name"
        initial={column.title}
        submitLabel="Rename"
        maxLength={40}
        pending={actions.update.isPending}
        onSubmit={(title) =>
          actions.update.mutate(
            { columnId: column.id, input: { title } },
            { onSuccess: () => setRenaming(false) },
          )
        }
      />
    </>
  );
}
