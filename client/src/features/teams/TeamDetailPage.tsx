import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Copy, Link2, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { DEMO_TEAM_SLUG, type TeamRole } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';
import { createInvite, getTeam, removeMember, teamKeys, updateMemberRole } from './teams.api';

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Copies text, reporting honestly when it cannot.
 *
 * `navigator.clipboard` is unavailable on insecure origins and can be refused
 * by permissions policy, so the promise really does reject in the wild. The
 * link stays visible in a read-only input either way, so there is always a
 * manual path.
 */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function InvitePanel({ teamId }: { teamId: string }) {
  const [copied, setCopied] = useState(false);

  const invite = useMutation({
    mutationFn: () => createInvite(teamId),
    onError: (error) => toast.error(message(error, 'Could not create an invite')),
  });

  const link = invite.data?.joinPath ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 aria-hidden="true" className="size-5 text-primary" />
          Invite people
        </CardTitle>
        <CardDescription>
          Generates a link that expires. Anyone with an account can redeem it once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={() => invite.mutate()} disabled={invite.isPending}>
          {invite.isPending && <Spinner label="Creating an invite link" />}
          {invite.data ? 'Generate a new link' : 'Create invite link'}
        </Button>

        {invite.data && (
          <div className="space-y-2">
            <Label htmlFor="invite-link">Invite link</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="invite-link" readOnly value={link} className="font-mono text-xs" />
              <Button
                variant="outline"
                onClick={() => {
                  void copyToClipboard(link).then((ok) => {
                    setCopied(ok);
                    toast[ok ? 'success' : 'error'](
                      ok ? 'Invite link copied' : 'Copy it manually - the browser refused',
                    );
                  });
                }}
              >
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                Copy
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Code <span className="font-mono">{invite.data.code}</span>, expires{' '}
              {new Date(invite.data.expiresAt).toLocaleString()}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** For a member, who cannot create invite links: how other people get in. */
function HowPeopleJoin({ isDemo, teamName }: { isDemo: boolean; teamName: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 aria-hidden="true" className="size-5 text-primary" />
          How people join
        </CardTitle>
        <CardDescription>
          {isDemo
            ? `Everyone who uses Try Live Demo is put in ${teamName}, so nobody needs an invite. Send them a meeting link and ask them to choose Try Live Demo. Somebody signed in with their own account cannot join this team's meetings; for that, create a team of your own and share its invite link.`
            : `Only admins can create invite links. Ask one of ${teamName}'s admins for an invite link, or create a team of your own.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link to="/app/teams">Create a team</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function TeamDetailPage() {
  const { teamId = '' } = useParams();
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.user);

  const team = useQuery({
    queryKey: teamKeys.detail(teamId),
    queryFn: () => getTeam(teamId),
    enabled: Boolean(teamId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: teamKeys.detail(teamId) });
    void queryClient.invalidateQueries({ queryKey: teamKeys.all });
  };

  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(teamId, userId),
    onSuccess: () => {
      refresh();
      toast.success('Member removed');
    },
    onError: (error) => toast.error(message(error, 'Could not remove that member')),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamRole }) =>
      updateMemberRole(teamId, userId, role),
    onSuccess: () => {
      refresh();
      toast.success('Role updated');
    },
    onError: (error) => toast.error(message(error, 'Could not change that role')),
  });

  if (team.isPending) {
    return (
      <div aria-live="polite" className="mx-auto w-full max-w-4xl space-y-4">
        <span className="sr-only">Loading team</span>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (team.isError) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <p className="text-sm text-destructive">
          {message(team.error, 'That team could not be loaded.')}
        </p>
        <Button asChild variant="outline">
          <Link to="/app/teams">Back to teams</Link>
        </Button>
      </div>
    );
  }

  const isAdmin = team.data.myRole === 'admin';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/app/teams">
            <ArrowLeft aria-hidden="true" />
            Teams
          </Link>
        </Button>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{team.data.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {team.data.members.length} member{team.data.members.length === 1 ? '' : 's'} - you are
          {isAdmin ? ' an admin' : ' a member'}
        </p>
      </div>

      {/* The invite panel is admin-only on the server too; hiding it here is a
          courtesy, not the control. A member is told why it is missing and
          how people get in instead, rather than left looking for it. */}
      {isAdmin ? (
        <InvitePanel teamId={teamId} />
      ) : (
        <HowPeopleJoin isDemo={team.data.slug === DEMO_TEAM_SLUG} teamName={team.data.name} />
      )}

      <section aria-labelledby="members">
        <h2 id="members" className="text-lg font-semibold tracking-tight">
          Members
        </h2>

        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {team.data.members.map((member) => {
            const isSelf = member.userId === me?.id;
            const isOwner = member.userId === team.data.ownerId;

            return (
              <li key={member.userId} className="flex flex-wrap items-center gap-3 p-4">
                <Avatar>
                  {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
                  <AvatarFallback>{initials(member.name)}</AvatarFallback>
                </Avatar>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {member.name}
                    {isSelf && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {member.email}
                  </span>
                </span>

                <Badge variant={member.role === 'admin' ? 'secondary' : 'outline'}>
                  {isOwner ? 'owner' : member.role}
                </Badge>

                {/* The owner is deliberately not demotable or removable: a team
                    with nobody able to administer it is unrecoverable. */}
                {isAdmin && !isOwner && !isSelf && (
                  <span className="flex w-full gap-2 sm:w-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={changeRole.isPending}
                      onClick={() =>
                        changeRole.mutate({
                          userId: member.userId,
                          role: member.role === 'admin' ? 'member' : 'admin',
                        })
                      }
                    >
                      {member.role === 'admin' ? 'Make member' : 'Make admin'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={remove.isPending}
                      aria-label={`Remove ${member.name} from the team`}
                      onClick={() => remove.mutate(member.userId)}
                    >
                      <UserMinus aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
