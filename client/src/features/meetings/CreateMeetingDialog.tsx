import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Video } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { ApiError } from '@/lib/apiClient';
import { listTeams, teamKeys } from '@/features/teams/teams.api';
import { createMeeting, meetingKeys } from './meetings.api';

/**
 * The form's own schema, not `createMeetingSchema`.
 *
 * The API takes an ISO timestamp; a browser's `datetime-local` input produces
 * `2026-09-24T14:30` in the user's own timezone. Validating the raw input here
 * and converting on submit keeps the boundary honest - the alternative is a
 * resolver that rejects everything the input can actually produce.
 */
const formSchema = z.object({
  teamId: z.string().min(1, 'Choose a team'),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(140),
  scheduledAt: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

/** The soonest a `datetime-local` input should allow, in its own format. */
function localNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function CreateMeetingDialog({ defaultTeamId }: { defaultTeamId?: string }) {
  const [open, setOpen] = useState(false);
  const [schedule, setSchedule] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const teams = useQuery({ queryKey: teamKeys.all, queryFn: listTeams });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { teamId: defaultTeamId ?? '', title: '', scheduledAt: '' },
  });

  // The team list arrives after the form mounts, so the default has to be
  // applied once it does - otherwise the picker shows a team while the form
  // still holds an empty string and submission fails validation.
  useEffect(() => {
    const firstTeam = teams.data?.[0];
    if (firstTeam) setValue('teamId', defaultTeamId ?? firstTeam.id);
  }, [teams.data, defaultTeamId, setValue]);

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      createMeeting({
        teamId: values.teamId,
        title: values.title,
        // A local datetime string has no timezone, so `new Date()` reads it in
        // the browser's zone - which is what the user meant - and toISOString
        // hands the server UTC.
        ...(schedule && values.scheduledAt
          ? { scheduledAt: new Date(values.scheduledAt).toISOString() }
          : {}),
      }),
    onSuccess: (meeting) => {
      void queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      setOpen(false);
      reset();

      if (meeting.status === 'live') {
        navigate(`/app/room/${meeting.roomCode}`);
      } else {
        toast.success(`"${meeting.title}" is scheduled`);
      }
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the meeting'),
  });

  const noTeams = teams.isSuccess && teams.data.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={noTeams}>
          <Video aria-hidden="true" />
          New meeting
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
          <DialogDescription>
            Meetings belong to a team - everyone in it can join and is notified when it starts.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          id="create-meeting"
          onSubmit={handleSubmit((values) => create.mutate(values))}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="meeting-team">Team</Label>
            <NativeSelect
              id="meeting-team"
              disabled={teams.isPending}
              aria-invalid={Boolean(errors.teamId)}
              {...register('teamId')}
            >
              {teams.isPending && <option value="">Loading…</option>}
              {teams.data?.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </NativeSelect>
            {errors.teamId && <p className="text-sm text-destructive">{errors.teamId.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting-title">Title</Label>
            <Input
              id="meeting-title"
              placeholder="Weekly sync"
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? 'meeting-title-error' : undefined}
              {...register('title')}
            />
            {errors.title && (
              <p id="meeting-title-error" className="text-sm text-destructive">
                {errors.title.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={schedule}
                onChange={(event) => setSchedule(event.target.checked)}
                className="size-4 accent-[var(--primary)]"
              />
              Schedule for later
            </label>

            {schedule && (
              <>
                <Label htmlFor="meeting-when" className="sr-only">
                  Date and time
                </Label>
                <Input
                  id="meeting-when"
                  type="datetime-local"
                  min={localNow()}
                  {...register('scheduledAt')}
                />
              </>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-meeting" disabled={create.isPending}>
            {create.isPending && <Spinner label="Creating the meeting" />}
            {schedule ? (
              <>
                <CalendarPlus aria-hidden="true" />
                Schedule
              </>
            ) : (
              <>
                <Video aria-hidden="true" />
                Start now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
