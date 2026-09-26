import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Copy, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { DEMO_TEAM_SLUG, type Meeting } from '@intellmeet/shared';
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
import { getTeam, teamKeys } from '@/features/teams/teams.api';

/**
 * The room link, and who can actually use it.
 *
 * A room link opens only for members of the meeting's team - it is not a pass
 * - and nothing used to say so. The Invite button copied the link and nothing
 * else, and the people it was sent to were told the meeting was "not
 * available". Saying who can join, at the moment the link is shared, is what
 * tells the host whether those people need an invite to the team first.
 */
export function InviteDialog({ meeting }: { meeting: Meeting }) {
  const [copied, setCopied] = useState(false);

  // The same query the mention picker already made for this team.
  const team = useQuery({
    queryKey: teamKeys.detail(meeting.teamId),
    queryFn: () => getTeam(meeting.teamId),
    staleTime: 60_000,
  });

  const link = `${window.location.origin}/app/room/${meeting.roomCode}`;

  function copy() {
    void navigator.clipboard
      .writeText(link)
      .then(() => {
        setCopied(true);
        toast.success('Invite link copied');
      })
      .catch(() => toast.error('Copy it manually - the browser refused'));
  }

  return (
    <Dialog onOpenChange={(open) => !open && setCopied(false)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus aria-hidden="true" />
          Invite
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>{whoCanJoin(team.data)}</DialogDescription>
        </DialogHeader>

        {team.data && team.data.slug !== DEMO_TEAM_SLUG && team.data.myRole === 'admin' && (
          <p className="text-sm">
            <Link
              to={`/app/teams/${team.data.id}`}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create a team invite link
            </Link>
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="room-invite-link">Meeting link</Label>
          <div className="flex gap-2">
            <Input
              id="room-invite-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button type="button" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Or they can type the room code{' '}
            <span className="font-mono font-medium text-foreground">{meeting.roomCode}</span> into
            Join with a code on their dashboard.
          </p>
        </div>

        <DialogFooter>
          <p className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
            The code only works until the meeting ends.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function whoCanJoin(team: { name: string; slug: string; myRole: string } | undefined): string {
  if (!team) return "Only members of this meeting's team can join.";

  if (team.slug === DEMO_TEAM_SLUG) {
    return `Only members of ${team.name} can join, and everyone who uses Try Live Demo is one. Send this link and ask them to choose Try Live Demo. Somebody signed in with their own account is not in this team and will be turned away.`;
  }

  if (team.myRole === 'admin') {
    return `Only members of ${team.name} can join. Anyone who is not in it yet needs a team invite link from you first; then this link lets them in.`;
  }

  return `Only members of ${team.name} can join. Anyone who is not in it yet needs a team invite link from one of its admins first.`;
}
