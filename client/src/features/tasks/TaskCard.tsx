import type { KeyboardEventHandler, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  GripVertical,
  Link2,
  MessageSquare,
} from 'lucide-react';
import type { Task } from '@intellmeet/shared';
import { Avatar, AvatarFallback, initials } from '@/components/ui/avatar';
import { formatDue } from '@/features/meetings/format';
import { cn } from '@/lib/utils';
import { isOverdue } from './due';

/**
 * A card on the board.
 *
 * Two controls, deliberately: the title opens the task, and the grip moves it.
 * A mouse or a finger (after a short press) can drag the card from anywhere,
 * but the keyboard drag lives on the grip alone - Enter on the title must
 * open the task rather than pick it up. Keyboard movers press Space on the
 * grip, arrow across and down, and Space again to drop; the task's own
 * "Column" picker is the other way to move without a mouse.
 */
export function TaskCard({
  task,
  done,
  onOpen,
}: {
  task: Task;
  done: boolean;
  onOpen: (task: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: 'task' } });
  // dnd-kit types its listeners loosely (`Function`); this one is the keyboard sensor's.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};
  const onHandleKeyDown = onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...pointerListeners}
      data-task-id={task.id}
      className={cn(
        'touch-manipulation rounded-lg border bg-card p-3 shadow-xs',
        isDragging && 'opacity-40',
      )}
    >
      <TaskCardBody
        task={task}
        done={done}
        onOpen={() => onOpen(task)}
        handle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            onKeyDown={onHandleKeyDown}
            aria-label={`Move ${task.title}`}
            className="-mr-1 -mt-1 shrink-0 cursor-grab rounded p-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
        }
      />
    </li>
  );
}

/** The card's contents; also what follows the pointer while dragging. */
export function TaskCardBody({
  task,
  done,
  onOpen,
  handle,
}: {
  task: Task;
  done: boolean;
  onOpen?: () => void;
  handle: ReactNode;
}) {
  const overdue = isOverdue(task.dueDate, done);
  const titleClass = cn(
    'min-w-0 flex-1 break-words text-left text-sm font-medium leading-snug',
    done && 'text-muted-foreground line-through',
  );

  return (
    <>
      <div className="flex items-start gap-1">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              titleClass,
              'rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            )}
          >
            {task.title}
          </button>
        ) : (
          // The copy that follows the pointer: nothing to press.
          <p className={titleClass}>{task.title}</p>
        )}
        {handle}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {task.priority === 'high' && (
          <span className="inline-flex items-center gap-0.5 font-medium text-destructive">
            <ArrowUp aria-hidden="true" className="size-3" />
            High
          </span>
        )}
        {task.priority === 'low' && (
          <span className="inline-flex items-center gap-0.5">
            <ArrowDown aria-hidden="true" className="size-3" />
            Low
          </span>
        )}
        {task.dueDate && (
          <span
            className={cn(
              'inline-flex items-center gap-1',
              overdue && 'rounded bg-destructive/10 px-1 font-medium text-destructive',
            )}
          >
            <CalendarClock aria-hidden="true" className="size-3" />
            {overdue ? 'Overdue' : 'Due'} {formatDue(task.dueDate)}
          </span>
        )}
        {task.source && (
          <span
            className="inline-flex items-center gap-0.5"
            title={`From “${task.source.meetingTitle}”`}
          >
            <Link2 aria-hidden="true" className="size-3" />
            <span className="sr-only">From a meeting</span>
          </span>
        )}
        {task.commentCount > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <MessageSquare aria-hidden="true" className="size-3" />
            {task.commentCount}
            <span className="sr-only"> {task.commentCount === 1 ? 'comment' : 'comments'}</span>
          </span>
        )}
        {task.assigneeName && (
          <Avatar className="ml-auto size-6" title={task.assigneeName}>
            <AvatarFallback className="text-[10px]">
              <span aria-hidden="true">{initials(task.assigneeName)}</span>
              <span className="sr-only">Assigned to {task.assigneeName}</span>
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </>
  );
}
