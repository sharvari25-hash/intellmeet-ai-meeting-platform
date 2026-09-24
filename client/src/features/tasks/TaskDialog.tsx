import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link2, Lock, MessageSquare, Trash2 } from 'lucide-react';
import {
  TASK_PRIORITIES,
  isoDateSchema,
  taskPermissions,
  type BoardDetail,
  type Task,
  type TeamMember,
} from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { FormError } from '@/features/auth/FormError';
import { formatDateTime, formatDue } from '@/features/meetings/format';
import { MentionSuggestions, MentionText } from '@/features/mentions/Mentions';
import { useMentionAutocomplete } from '@/features/mentions/useMentionAutocomplete';
import { getTeam, teamKeys } from '@/features/teams/teams.api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { groupByColumn } from './boardCache';
import { isOverdue } from './due';
import { getBoard, listComments, taskKeys } from './tasks.api';
import { useAddComment, useDeleteTask, useMoveTask, useUpdateTask } from './useTaskMutations';

const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' } as const;

/**
 * One task, opened from the board, My Tasks or a notification (`?task=`).
 *
 * Reads the task from its board's cached copy, so on the board it updates
 * live as other people change it. Offers only what the viewer may do
 * (`taskPermissions`, the same rule the server enforces): a sample task shows
 * its details read-only to anyone but an admin, and still has the Column
 * picker, which is also the way to move a task without dragging.
 */
export function TaskDialog({
  taskId,
  boardId,
  onClose,
}: {
  taskId: string;
  boardId: string;
  onClose: () => void;
}) {
  const board = useQuery({ queryKey: taskKeys.board(boardId), queryFn: () => getBoard(boardId) });
  const task = board.data?.tasks.find((entry) => entry.id === taskId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        {board.isPending && (
          <DialogHeader>
            <DialogTitle className="sr-only">Loading the task</DialogTitle>
            <Spinner label="Loading the task" />
          </DialogHeader>
        )}
        {(board.isError || (board.data && !task)) && (
          <DialogHeader>
            <DialogTitle>Task not found</DialogTitle>
            <DialogDescription>
              It may have been deleted, or moved to a board you cannot see.
            </DialogDescription>
          </DialogHeader>
        )}
        {board.data && task && <TaskDetails detail={board.data} task={task} onDeleted={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskDetails({
  detail,
  task,
  onDeleted,
}: {
  detail: BoardDetail;
  task: Task;
  onDeleted: () => void;
}) {
  const user = useAuthStore((state) => state.user);
  const permissions = taskPermissions({
    viewerId: user?.id ?? '',
    viewerRole: detail.board.myRole,
    task,
  });
  const team = useQuery({
    queryKey: teamKeys.detail(task.teamId),
    queryFn: () => getTeam(task.teamId),
    staleTime: 60_000,
  });
  const members = team.data?.members ?? [];

  const columnId = useId();
  const move = useMoveTask(detail.board.id);
  const column = detail.board.columns.find((entry) => entry.id === task.columnId);

  /** To the bottom of the chosen column, like a card dropped at the end. */
  function moveTo(targetId: string) {
    if (targetId === task.columnId) return;
    const target = (groupByColumn(detail).get(targetId) ?? []).filter((t) => t.id !== task.id);
    move.mutate({
      taskId: task.id,
      columnId: targetId,
      afterId: target.at(-1)?.id ?? null,
      beforeId: null,
    });
  }

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <DialogTitle className="pr-6 leading-snug">{task.title}</DialogTitle>
        <DialogDescription>
          On {detail.board.name}, added by {task.createdByName} on {formatDateTime(task.createdAt)}
        </DialogDescription>
      </DialogHeader>

      {task.seeded && !permissions.canEdit && (
        <p className="flex gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />A sample task everyone
          trying the demo shares. Move it to any column; only a team admin can change or delete it.
        </p>
      )}

      <div className="grid gap-2 sm:max-w-60">
        <Label htmlFor={columnId}>Column</Label>
        <NativeSelect
          id={columnId}
          value={task.columnId}
          disabled={move.isPending}
          onChange={(event) => moveTo(event.target.value)}
        >
          {detail.board.columns.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </NativeSelect>
      </div>

      {permissions.canEdit ? (
        <TaskForm task={task} boardId={detail.board.id} members={members} />
      ) : (
        <TaskFacts task={task} done={column?.isDone ?? false} />
      )}

      {task.source && (
        <p className="flex items-center gap-1.5 text-sm">
          <Link2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          From the meeting{' '}
          <Link
            to={`/app/meetings/${task.source.meetingId}?tab=actions`}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {task.source.meetingTitle}
          </Link>
        </p>
      )}

      <Comments task={task} boardId={detail.board.id} members={members} selfId={user?.id} />

      {permissions.canDelete && (
        <DeleteTask boardId={detail.board.id} task={task} onDeleted={onDeleted} />
      )}
    </div>
  );
}

// --- Editing ----------------------------------------------------------------------

const formSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().max(5000),
  assigneeId: z.string(),
  dueDate: z
    .string()
    .refine((value) => value === '' || isoDateSchema.safeParse(value).success, 'Not a real date'),
  priority: z.enum(TASK_PRIORITIES),
});
type FormValues = z.infer<typeof formSchema>;

function toForm(task: Task): FormValues {
  return {
    title: task.title,
    description: task.description,
    assigneeId: task.assigneeId ?? '',
    dueDate: task.dueDate ?? '',
    priority: task.priority,
  };
}

function TaskForm({
  task,
  boardId,
  members,
}: {
  task: Task;
  boardId: string;
  members: TeamMember[];
}) {
  const update = useUpdateTask(boardId, task.id);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(task),
  });
  const errors = form.formState.errors;

  // Somebody else changed it: show theirs, unless this form has unsaved edits.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toForm(task));
    // The version is what changes; the object is new on every cache edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.version]);

  const onSubmit = form.handleSubmit((values) =>
    update.mutate(
      {
        title: values.title,
        description: values.description.trim(),
        assigneeId: values.assigneeId || null,
        dueDate: values.dueDate || null,
        priority: values.priority,
      },
      { onSuccess: (saved) => form.reset(toForm(saved)) },
    ),
  );

  // An owner who has since left the team is still shown, not silently dropped.
  const owners = members.some((member) => member.userId === task.assigneeId)
    ? members
    : task.assigneeId
      ? [
          ...members,
          { userId: task.assigneeId, name: task.assigneeName ?? 'Former member' } as TeamMember,
        ]
      : members;

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate aria-label="Task details">
      <div className="grid gap-2">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          maxLength={200}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'task-title-error' : undefined}
          {...form.register('title')}
        />
        {errors.title && (
          <p id="task-title-error" className="text-sm text-destructive">
            {errors.title.message}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="task-assignee">Assignee</Label>
          <NativeSelect id="task-assignee" {...form.register('assigneeId')}>
            <option value="">Unassigned</option>
            {owners.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="task-due">Due date</Label>
          <Input
            id="task-due"
            type="date"
            aria-invalid={errors.dueDate ? true : undefined}
            {...form.register('dueDate')}
          />
          {errors.dueDate && <p className="text-sm text-destructive">{errors.dueDate.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="task-priority">Priority</Label>
          <NativeSelect id="task-priority" {...form.register('priority')}>
            {TASK_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="task-description">Description</Label>
        <Textarea
          id="task-description"
          rows={3}
          maxLength={5000}
          placeholder="Anything the person doing it should know"
          {...form.register('description')}
        />
      </div>

      <FormError error={update.error} />

      <div>
        <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
          {update.isPending && <Spinner label="Saving" />}
          Save changes
        </Button>
      </div>
    </form>
  );
}

/** The same details, read-only. */
function TaskFacts({ task, done }: { task: Task; done: boolean }) {
  const overdue = isOverdue(task.dueDate, done);
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-muted-foreground">Assignee</dt>
        <dd className="font-medium">{task.assigneeName ?? 'Unassigned'}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Due date</dt>
        <dd className={cn('font-medium', overdue && 'text-destructive')}>
          {task.dueDate ? `${formatDue(task.dueDate)}${overdue ? ' (overdue)' : ''}` : 'None'}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Priority</dt>
        <dd className="font-medium">{PRIORITY_LABELS[task.priority]}</dd>
      </div>
      {task.description && (
        <div className="sm:col-span-3">
          <dt className="text-muted-foreground">Description</dt>
          <dd className="whitespace-pre-wrap">{task.description}</dd>
        </div>
      )}
    </dl>
  );
}

// --- Comments ------------------------------------------------------------------------

function Comments({
  task,
  boardId,
  members,
  selfId,
}: {
  task: Task;
  boardId: string;
  members: TeamMember[];
  selfId: string | undefined;
}) {
  const comments = useQuery({
    queryKey: taskKeys.comments(task.id),
    queryFn: () => listComments(task.id),
  });
  const add = useAddComment(boardId, task.id);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const everyone = useMemo(
    () => members.map((member) => ({ id: member.userId, name: member.name })),
    [members],
  );
  // Suggest everyone but yourself: mentioning yourself notifies nobody.
  const others = useMemo(
    () => everyone.filter((person) => person.id !== selfId),
    [everyone, selfId],
  );
  const mentions = useMentionAutocomplete({
    value: draft,
    onValueChange: setDraft,
    people: others,
    inputRef,
  });

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim() || add.isPending) return;
    add.mutate(draft.trim(), { onSuccess: () => setDraft('') });
  }

  const list = comments.data ?? [];

  return (
    <section aria-labelledby="task-comments-heading" className="grid gap-3 border-t pt-4">
      <h3 id="task-comments-heading" className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare aria-hidden="true" className="size-4" />
        Comments
        {list.length > 0 && (
          <span className="font-normal text-muted-foreground">({list.length})</span>
        )}
      </h3>

      {comments.isPending && <Spinner label="Loading comments" />}
      {comments.data && list.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No comments yet. Type @ to mention a team-mate; they get a notification.
        </p>
      )}
      {list.length > 0 && (
        <ol className="grid gap-3">
          {list.map((comment) => (
            <li key={comment.id} className="text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{comment.authorName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(comment.createdAt)}
                </span>
              </p>
              <p className="whitespace-pre-wrap break-words">
                <MentionText text={comment.text} people={everyone} />
              </p>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={submit} className="grid gap-2">
        <Label htmlFor="task-comment">Add a comment</Label>
        <div className="relative">
          <Textarea
            id="task-comment"
            ref={inputRef}
            rows={2}
            maxLength={2000}
            value={draft}
            placeholder="Type @ to mention someone"
            {...mentions.fieldProps}
            onKeyDown={(event) => {
              if (mentions.handleKeyDown(event)) return;
              // Ctrl/Cmd+Enter posts, as in most comment boxes.
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit();
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              mentions.handleChange(event);
            }}
          />
          <MentionSuggestions
            id={mentions.listboxId}
            suggestions={mentions.suggestions}
            active={mentions.active}
            onChoose={mentions.choose}
            placement="below"
          />
        </div>
        <FormError error={add.error} />
        <div>
          <Button type="submit" size="sm" disabled={!draft.trim() || add.isPending}>
            {add.isPending && <Spinner label="Posting" />}
            Comment
          </Button>
        </div>
      </form>
    </section>
  );
}

// --- Deleting ------------------------------------------------------------------------

function DeleteTask({
  boardId,
  task,
  onDeleted,
}: {
  boardId: string;
  task: Task;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useDeleteTask(boardId, task.id);

  if (!confirming) {
    return (
      <div className="border-t pt-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" />
          Delete task
        </Button>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Confirm deleting the task" className="grid gap-2 border-t pt-4">
      <p className="text-sm">Delete this task and its comments? This cannot be undone.</p>
      <FormError error={remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => remove.mutate(undefined, { onSuccess: onDeleted })}
        >
          {remove.isPending && <Spinner label="Deleting" />}
          Delete
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
