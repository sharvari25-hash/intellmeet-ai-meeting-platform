import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Inbox } from 'lucide-react';
import { SOCKET_EVENTS, type MyTask, type Notification } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDue } from '@/features/meetings/format';
import { cn } from '@/lib/utils';
import { useSocketStore } from '@/stores/socketStore';
import { isOverdue, todayIso } from './due';
import { listMyTasks, taskKeys } from './tasks.api';

/**
 * Everything assigned to me, on every board of every team, in the order it
 * needs attention: overdue first, then by due date, then undated, and
 * finished work last.
 */
export function MyTasksView({ onOpen }: { onOpen: (task: MyTask) => void }) {
  const tasks = useQuery({ queryKey: taskKeys.mine, queryFn: listMyTasks });
  const socket = useSocketStore((state) => state.socket);
  const queryClient = useQueryClient();

  // Given something new while looking at the list: the bell's push is the cue.
  useEffect(() => {
    if (!socket) return;
    const onNotification = (raw: unknown) => {
      if ((raw as Notification).type === 'task_assigned') {
        void queryClient.invalidateQueries({ queryKey: taskKeys.mine });
      }
    };
    socket.on(SOCKET_EVENTS.NOTIFY_NEW, onNotification);
    return () => {
      socket.off(SOCKET_EVENTS.NOTIFY_NEW, onNotification);
    };
  }, [socket, queryClient]);

  const groups = useMemo(() => {
    const today = todayIso();
    const all = tasks.data ?? [];
    const open = all.filter((task) => !task.isDone);
    const byDue = (a: MyTask, b: MyTask) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '');
    return [
      {
        key: 'overdue',
        title: 'Overdue',
        icon: AlertTriangle,
        tasks: open.filter((task) => isOverdue(task.dueDate, false, today)).sort(byDue),
      },
      {
        key: 'upcoming',
        title: 'Coming up',
        icon: CalendarClock,
        tasks: open
          .filter((task) => task.dueDate !== null && !isOverdue(task.dueDate, false, today))
          .sort(byDue),
      },
      {
        key: 'undated',
        title: 'No due date',
        icon: Inbox,
        tasks: open.filter((task) => task.dueDate === null),
      },
      {
        key: 'done',
        title: 'Done',
        icon: CheckCircle2,
        tasks: all.filter((task) => task.isDone),
      },
    ].filter((group) => group.tasks.length > 0);
  }, [tasks.data]);

  if (tasks.isPending) {
    return (
      <div aria-live="polite" className="space-y-3">
        <span className="sr-only">Loading your tasks</span>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (tasks.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load your tasks.{' '}
        <button type="button" className="underline" onClick={() => void tasks.refetch()}>
          Try again
        </button>
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
        Nothing is assigned to you. Tasks given to you on any of your teams’ boards appear here.
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      {groups.map(({ key, title, icon: Icon, tasks: list }) => (
        <section key={key} aria-labelledby={`mine-${key}`}>
          <h2
            id={`mine-${key}`}
            className={cn(
              'mb-2 flex items-center gap-2 text-sm font-semibold',
              key === 'overdue' && 'text-destructive',
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {title}
            <span className="font-normal text-muted-foreground">({list.length})</span>
          </h2>
          <ul className="space-y-2">
            {list.map((task) => (
              <MyTaskRow key={task.id} task={task} onOpen={() => onOpen(task)} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MyTaskRow({ task, onOpen }: { task: MyTask; onOpen: () => void }) {
  const overdue = isOverdue(task.dueDate, task.isDone);

  return (
    <li
      className={cn(
        'rounded-lg border bg-card p-3',
        overdue && 'border-destructive/50 bg-destructive/5',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'break-words text-left text-sm font-medium hover:underline',
          'rounded-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          task.isDone && 'text-muted-foreground line-through',
        )}
      >
        {task.title}
      </button>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant={task.isDone ? 'success' : 'secondary'}>{task.columnTitle}</Badge>
        <span>
          {task.boardName} · {task.teamName}
        </span>
        {task.dueDate && (
          <span className={cn(overdue && 'font-medium text-destructive')}>
            {overdue ? 'Overdue, was due' : 'Due'} {formatDue(task.dueDate)}
          </span>
        )}
        {task.priority === 'high' && (
          <span className="font-medium text-destructive">High priority</span>
        )}
      </p>
    </li>
  );
}
