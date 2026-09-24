import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { ActionItem, Meeting } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { FormError } from '@/features/auth/FormError';
import { createTasksFromActionItems, taskKeys, taskPath } from '@/features/tasks/tasks.api';
import { getTeam, teamKeys } from '@/features/teams/teams.api';
import { aiKeys } from '../ai.api';

interface Row {
  id: string;
  text: string;
  include: boolean;
  assigneeId: string;
  dueDate: string;
  /** A name the AI heard that matched nobody, shown as a hint. */
  heard: string | null;
}

function toRow(item: ActionItem): Row {
  return {
    id: item.id,
    text: item.text,
    include: true,
    // Pre-filled from the AI's match; the person filing it may change it.
    assigneeId: item.assigneeId ?? '',
    dueDate: item.dueDate ?? '',
    heard: item.assigneeId ? null : item.assigneeName,
  };
}

/**
 * Turns action items into tasks on the team's board: one (from an item's own
 * button) or several at once (from "Create tasks for all").
 *
 * Each owner and deadline starts as the AI understood it and can be changed
 * here first; anyone in the team can be chosen, not only the people who were
 * in the meeting. The tasks land at the bottom of the board's first column,
 * and the items then show where their tasks are.
 */
export function CreateTasksDialog({
  meeting,
  items,
  open,
  onOpenChange,
}: {
  meeting: Meeting;
  items: ActionItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const single = items.length === 1;

  const team = useQuery({
    queryKey: teamKeys.detail(meeting.teamId),
    queryFn: () => getTeam(meeting.teamId),
    enabled: open,
    staleTime: 60_000,
  });
  const members = team.data?.members ?? [];

  // Fresh from the items each time the dialog opens.
  useEffect(() => {
    if (open) setRows(items.map(toRow));
  }, [open, items]);

  const create = useMutation({
    mutationFn: () =>
      createTasksFromActionItems(meeting.id, {
        items: rows
          .filter((row) => row.include)
          .map((row) => ({
            actionItemId: row.id,
            assigneeId: row.assigneeId || null,
            dueDate: row.dueDate || null,
          })),
      }),
    onSuccess: (result) => {
      // The items now carry their tasks; boards and My Tasks reload when shown.
      queryClient.setQueryData(aiKeys.intelligence(meeting.id), result.intelligence);
      void queryClient.invalidateQueries({ queryKey: ['boards'] });
      void queryClient.invalidateQueries({ queryKey: taskKeys.mine });
      onOpenChange(false);

      const [first] = result.tasks;
      const count = result.tasks.length;
      if (first) {
        toast.success(
          count === 1 ? 'Task added to the team board' : `${count} tasks added to the team board`,
          { action: { label: 'Open the board', onClick: () => navigate(taskPath(first)) } },
        );
      }
      if (result.skipped.length > 0) {
        toast.info(
          result.skipped.length === 1
            ? 'One item already had a task, so it was left as it was.'
            : `${result.skipped.length} items already had tasks, so they were left as they were.`,
        );
      }
    },
  });

  const chosen = rows.filter((row) => row.include).length;

  function edit(index: number, change: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen > 0) create.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) create.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{single ? 'Create a task' : 'Create tasks from action items'}</DialogTitle>
            <DialogDescription>
              {single ? 'It goes' : 'They go'} to the first column of the team’s board. Owners and
              due dates start as the AI heard them; change them here if they are wrong.
            </DialogDescription>
          </DialogHeader>

          <ul className="grid gap-3">
            {rows.map((row, index) => {
              const owners =
                row.assigneeId && !members.some((member) => member.userId === row.assigneeId)
                  ? [...members, { userId: row.assigneeId, name: 'Current owner' }]
                  : members;
              return (
                <li key={row.id} className="grid gap-2 rounded-lg border p-3">
                  {single ? (
                    <p className="text-sm font-medium">{row.text}</p>
                  ) : (
                    <label className="flex items-start gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={row.include}
                        onChange={(event) => edit(index, { include: event.target.checked })}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                      />
                      {row.text}
                    </label>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`new-task-${index}-owner`} className="text-xs">
                        Assignee
                        <span className="sr-only"> for “{row.text}”</span>
                      </Label>
                      <NativeSelect
                        id={`new-task-${index}-owner`}
                        value={row.assigneeId}
                        disabled={!row.include}
                        onChange={(event) => edit(index, { assigneeId: event.target.value })}
                      >
                        <option value="">Unassigned</option>
                        {owners.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.name}
                          </option>
                        ))}
                      </NativeSelect>
                      {row.heard && !row.assigneeId && (
                        <p className="text-xs text-muted-foreground">
                          The AI heard “{row.heard}”, who is not in the team.
                        </p>
                      )}
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`new-task-${index}-due`} className="text-xs">
                        Due date
                        <span className="sr-only"> for “{row.text}”</span>
                      </Label>
                      <Input
                        id={`new-task-${index}-due`}
                        type="date"
                        value={row.dueDate}
                        disabled={!row.include}
                        onChange={(event) => edit(index, { dueDate: event.target.value })}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <FormError error={create.error} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || chosen === 0}>
              {create.isPending && <Spinner label="Creating" />}
              {single ? 'Create task' : `Create ${chosen} ${chosen === 1 ? 'task' : 'tasks'}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
