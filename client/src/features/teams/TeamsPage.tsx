import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  createTeamSchema,
  joinTeamSchema,
  type CreateTeamInput,
  type JoinTeamInput,
} from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { createTeam, joinTeam, listTeams, teamKeys } from './teams.api';

/** Turns any thrown value into something worth showing a person. */
function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function CreateTeamForm() {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTeamInput>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { name: '' },
  });

  const create = useMutation({
    mutationFn: (values: CreateTeamInput) => createTeam(values.name),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.all });
      reset();
      toast.success(`Created ${team.name}`);
    },
    onError: (error) => toast.error(message(error, 'Could not create the team')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus aria-hidden="true" className="size-5 text-primary" />
          Create a team
        </CardTitle>
        <CardDescription>You become its admin and can invite people straight away.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={handleSubmit((values) => create.mutate(values))}
          className="space-y-2"
        >
          <Label htmlFor="team-name">Team name</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="team-name"
              placeholder="Platform team"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'team-name-error' : undefined}
              {...register('name')}
            />
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner label="Creating the team" />}
              Create
            </Button>
          </div>
          {errors.name && (
            <p id="team-name-error" className="text-sm text-destructive">
              {errors.name.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function JoinTeamForm() {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<JoinTeamInput>({
    resolver: zodResolver(joinTeamSchema),
    defaultValues: { code: '' },
  });

  const join = useMutation({
    mutationFn: (values: JoinTeamInput) => joinTeam(values.code),
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: teamKeys.all });
      reset();
      toast.success(`Joined ${team.name}`);
    },
    onError: (error) => toast.error(message(error, 'Could not redeem that code')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users aria-hidden="true" className="size-5 text-primary" />
          Join a team
        </CardTitle>
        <CardDescription>Paste the invite code a team admin sent you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={handleSubmit((values) => join.mutate(values))}
          className="space-y-2"
        >
          <Label htmlFor="invite-code">Invite code</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="invite-code"
              placeholder="ABC23XYZ"
              autoCapitalize="characters"
              className="uppercase"
              aria-invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? 'invite-code-error' : undefined}
              {...register('code')}
            />
            <Button type="submit" variant="outline" disabled={join.isPending}>
              {join.isPending && <Spinner label="Joining the team" />}
              Join
            </Button>
          </div>
          {errors.code && (
            <p id="invite-code-error" className="text-sm text-destructive">
              {errors.code.message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function TeamsPage() {
  const teams = useQuery({ queryKey: teamKeys.all, queryFn: listTeams });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A team is the boundary for everything: meetings, tasks and history all belong to one.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <CreateTeamForm />
        <JoinTeamForm />
      </div>

      <section aria-labelledby="your-teams">
        <h2 id="your-teams" className="text-lg font-semibold tracking-tight">
          Your teams
        </h2>

        <div className="mt-3">
          {teams.isPending && (
            <div aria-live="polite" className="space-y-3">
              <span className="sr-only">Loading teams</span>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {teams.isError && <p className="text-sm text-destructive">Could not load your teams.</p>}

          {teams.isSuccess && teams.data.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You are not in a team yet. Create one above, or redeem an invite code.
            </p>
          )}

          {teams.isSuccess && teams.data.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {teams.data.map((team) => (
                <li key={team.id}>
                  <Link
                    to={`/app/teams/${team.id}`}
                    className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
                    >
                      {team.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{team.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {team.members.length} member{team.members.length === 1 ? '' : 's'}
                      </span>
                    </span>
                    {team.myRole === 'admin' && <Badge variant="secondary">Admin</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
