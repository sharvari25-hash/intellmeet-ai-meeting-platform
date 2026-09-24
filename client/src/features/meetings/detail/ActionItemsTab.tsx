import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Circle, KanbanSquare, ListChecks, Pencil, Plus, X } from 'lucide-react';
import {
  isoDateSchema,
  type ActionItem,
  type ActionItemInput,
  type Meeting,
  type MeetingInsight,
} from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { FormError } from '@/features/auth/FormError';
import { taskPath } from '@/features/tasks/tasks.api';
import { cn } from '@/lib/utils';
import { formatDue } from '../format';
import { useUpdateInsight } from '../useUpdateInsight';
import { CreateTasksDialog } from './CreateTasksDialog';
import { EditedNote, HostOnlyNote } from './notes';

/** An item as the API takes it back: everything the host can change. */
function toInput(item: ActionItem): ActionItemInput {
  return {
    id: item.id,
    text: item.text,
    assigneeId: item.assigneeId,
    assigneeName: item.assigneeName,
    dueDate: item.dueDate,
    status: item.status,
  };
}

export function ActionItemsTab({
  meeting,
  insight,
}: {
  meeting: Meeting;
  insight: MeetingInsight;
}) {
  const [editing, setEditing] = useState(false);
  // The items the "create tasks" dialog is open for; empty when it is closed.
  const [filing, setFiling] = useState<ActionItem[]>([]);
  const save = useUpdateInsight(meeting.id);
  const items = insight.actionItems;
  const open = items.filter((item) => item.status !== 'done').length;
  const withoutTasks = items.filter((item) => !item.task);

  if (editing) {
    return <ActionItemsForm meeting={meeting} insight={insight} onDone={() => setEditing(false)} />;
  }

  /** Ticking an item off is the one edit worth a single click. */
  function toggle(target: ActionItem) {
    save.mutate({
      actionItems: items.map((item) =>
        toInput(
          item.id === target.id
            ? { ...item, status: item.status === 'done' ? 'open' : 'done' }
            : item,
        ),
      ),
    });
  }

  return (
    <section
      aria-labelledby="actions-heading"
      className="space-y-4 rounded-xl border bg-card p-5"
      aria-busy={save.isPending}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="actions-heading" className="flex items-center gap-2 font-semibold">
          <ListChecks aria-hidden="true" className="size-4 text-primary" />
          Action items
        </h2>
        {items.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {open} open of {items.length}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {/* Anyone in the team can file the tasks; often not the host's job. */}
          {withoutTasks.length > 1 && (
            <Button variant="outline" size="sm" onClick={() => setFiling(withoutTasks)}>
              <KanbanSquare aria-hidden="true" />
              Create tasks for all ({withoutTasks.length})
            </Button>
          )}
          {meeting.isHost && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" />
              Edit action items
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No action items were assigned.</p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => {
            const done = item.status === 'done';
            return (
              <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                {meeting.isHost ? (
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={save.isPending}
                    onChange={() => toggle(item)}
                    aria-label={`Done: ${item.text}`}
                    className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                  />
                ) : done ? (
                  <CheckCircle2
                    aria-label="Done"
                    className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
                  />
                ) : (
                  <Circle
                    aria-label="Open"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                )}

                <div className="min-w-0 flex-1 text-sm">
                  <p className={cn(done && 'text-muted-foreground line-through')}>{item.text}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {item.assigneeName ? (
                      <Badge variant={item.assigneeId ? 'secondary' : 'outline'}>
                        {item.assigneeName}
                        {/* A name the model heard that matches nobody in the
                            meeting: shown, but flagged for the host. */}
                        {!item.assigneeId && ' (not a participant)'}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Unassigned</Badge>
                    )}
                    {item.dueDate && <span>Due {formatDue(item.dueDate)}</span>}
                  </p>
                </div>

                {item.task ? (
                  // Where its task is now, read live from the board.
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link
                      to={taskPath(item.task)}
                      aria-label={`Open the task for “${item.text}”, in ${item.task.columnTitle}`}
                    >
                      {item.task.isDone ? (
                        <CheckCircle2 aria-hidden="true" className="text-[var(--success)]" />
                      ) : (
                        <KanbanSquare aria-hidden="true" />
                      )}
                      {/* Icon-only on a phone, where the row has no room for it. */}
                      <span className="hidden sm:inline">{item.task.columnTitle}</span>
                    </Link>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Create a task for “${item.text}”`}
                    onClick={() => setFiling([item])}
                  >
                    <KanbanSquare aria-hidden="true" />
                    <span className="hidden sm:inline">Create task</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <FormError error={save.error} />

      <EditedNote insight={insight} />
      {!meeting.isHost && <HostOnlyNote hostName={meeting.hostName} />}

      <CreateTasksDialog
        meeting={meeting}
        items={filing}
        open={filing.length > 0}
        onOpenChange={(next) => {
          if (!next) setFiling([]);
        }}
      />
    </section>
  );
}

// --- Editing --------------------------------------------------------------------

/**
 * The owner picker's value: nobody, an account (`user:<id>`), or a name the
 * AI heard that belongs to no account (`name:<name>`), which is kept as an
 * option so saving an unrelated change does not silently drop it.
 */
type OwnerValue = '' | `user:${string}` | `name:${string}`;

function ownerValue(item: Pick<ActionItem, 'assigneeId' | 'assigneeName'>): OwnerValue {
  if (item.assigneeId) return `user:${item.assigneeId}`;
  if (item.assigneeName) return `name:${item.assigneeName}`;
  return '';
}

/** Everyone an item can be given to: the host, the attendees, and current owners. */
function ownerOptions(meeting: Meeting, items: ActionItem[]) {
  const people = new Map<string, string>([[meeting.hostId, meeting.hostName]]);
  for (const person of meeting.participants) people.set(person.userId, person.name);
  for (const item of items) {
    if (item.assigneeId && !people.has(item.assigneeId)) {
      people.set(item.assigneeId, item.assigneeName ?? 'Former member');
    }
  }

  const heardNames = [
    ...new Set(items.flatMap((i) => (i.assigneeName && !i.assigneeId ? [i.assigneeName] : []))),
  ];

  return [
    ...[...people.entries()].map(([id, name]) => ({ value: `user:${id}`, label: name })),
    ...heardNames.map((name) => ({ value: `name:${name}`, label: `${name} (not a participant)` })),
  ];
}

/**
 * The form's own schema: strings for the owner and the date, because that is
 * what a `<select>` and an `<input type="date">` produce. Converted to the
 * API's `ActionItemInput` on submit.
 */
const itemsFormSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string().trim().min(1, 'Describe the action item').max(500),
        owner: z.string(),
        dueDate: z
          .string()
          .refine((value) => value === '' || isoDateSchema.safeParse(value).success, {
            message: 'Not a real date',
          }),
        done: z.boolean(),
      }),
    )
    .max(100),
});
type ItemsFormValues = z.infer<typeof itemsFormSchema>;

function fromForm(row: ItemsFormValues['items'][number]): ActionItemInput {
  const [kind, ...rest] = row.owner.split(':');
  const value = rest.join(':');
  return {
    ...(row.id ? { id: row.id } : {}),
    text: row.text.trim(),
    assigneeId: kind === 'user' ? value : null,
    assigneeName: kind === 'name' ? value : null,
    dueDate: row.dueDate || null,
    status: row.done ? 'done' : 'open',
  };
}

function ActionItemsForm({
  meeting,
  insight,
  onDone,
}: {
  meeting: Meeting;
  insight: MeetingInsight;
  onDone: () => void;
}) {
  const save = useUpdateInsight(meeting.id);
  const options = ownerOptions(meeting, insight.actionItems);

  const form = useForm<ItemsFormValues>({
    resolver: zodResolver(itemsFormSchema),
    defaultValues: {
      items: insight.actionItems.map((item) => ({
        id: item.id,
        text: item.text,
        owner: ownerValue(item),
        dueDate: item.dueDate ?? '',
        done: item.status === 'done',
      })),
    },
  });
  const rows = useFieldArray({ control: form.control, name: 'items', keyName: 'key' });
  const errors = form.formState.errors.items;

  const onSubmit = form.handleSubmit((values) => {
    save.mutate({ actionItems: values.items.map(fromForm) }, { onSuccess: onDone });
  });

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby="edit-actions-heading"
      className="space-y-4 rounded-xl border bg-card p-5"
      noValidate
    >
      <h2 id="edit-actions-heading" className="font-semibold">
        Edit action items
      </h2>

      {rows.fields.length === 0 && (
        <p className="text-sm text-muted-foreground">No action items. Add one below.</p>
      )}

      <ol className="space-y-3">
        {rows.fields.map((row, index) => {
          const number = index + 1;
          const textError = errors?.[index]?.text?.message;
          const dateError = errors?.[index]?.dueDate?.message;
          return (
            <li
              key={row.key}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_11rem_10rem]"
            >
              <div className="sm:col-span-3">
                <Label htmlFor={`item-${index}-text`} className="sr-only">
                  Action item {number}
                </Label>
                <Input
                  id={`item-${index}-text`}
                  placeholder="What needs doing"
                  maxLength={500}
                  aria-invalid={textError ? true : undefined}
                  aria-describedby={textError ? `item-${index}-text-error` : undefined}
                  {...form.register(`items.${index}.text`)}
                />
                {textError && (
                  <p id={`item-${index}-text-error`} className="mt-1 text-sm text-destructive">
                    {textError}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor={`item-${index}-owner`} className="sr-only">
                  Owner of action item {number}
                </Label>
                <NativeSelect id={`item-${index}-owner`} {...form.register(`items.${index}.owner`)}>
                  <option value="">Unassigned</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div>
                <Label htmlFor={`item-${index}-due`} className="sr-only">
                  Due date of action item {number}
                </Label>
                <Input
                  id={`item-${index}-due`}
                  type="date"
                  aria-invalid={dateError ? true : undefined}
                  {...form.register(`items.${index}.dueDate`)}
                />
                {dateError && <p className="mt-1 text-sm text-destructive">{dateError}</p>}
              </div>

              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    {...form.register(`items.${index}.done`)}
                  />
                  Done
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove action item ${number}`}
                  onClick={() => rows.remove(index)}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          rows.append({ text: '', owner: '', dueDate: '', done: false }, { shouldFocus: true })
        }
      >
        <Plus aria-hidden="true" />
        Add an action item
      </Button>

      <FormError error={save.error} />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Spinner label="Saving" />}
          Save changes
        </Button>
        <Button type="button" variant="outline" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
