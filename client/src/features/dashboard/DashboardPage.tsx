import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { CalendarClock, Radio, Users, Video } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CreateMeetingDialog } from '@/features/meetings/CreateMeetingDialog';
import { listMeetings, meetingKeys } from '@/features/meetings/meetings.api';
import { listTeams, teamKeys } from '@/features/teams/teams.api';
import { useAuthStore } from '@/stores/authStore';

/** Readable date for a meeting row, without pulling in a date library. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function StatusBadge({ status }: { status: 'scheduled' | 'live' | 'ended' }) {
  if (status === 'live') {
    return (
      <Badge variant="success">
        <Radio aria-hidden="true" className="animate-pulse" />
        Live
      </Badge>
    );
  }
  return <Badge variant={status === 'scheduled' ? 'secondary' : 'outline'}>{status}</Badge>;
}

function MeetingRows() {
  const { data, isPending, isError } = useQuery({
    queryKey: meetingKeys.list(),
    queryFn: () => listMeetings({ limit: 5 }),
  });

  if (isPending) {
    return (
      <div aria-live="polite" className="space-y-3">
        <span className="sr-only">Loading meetings</span>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-destructive">Could not load your meetings.</p>;
  }

  if (data.meetings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No meetings yet. Start one above and it will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {data.meetings.map((meeting) => (
        <li key={meeting.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
          <span className="min-w-0 flex-1 truncate font-medium">{meeting.title}</span>
          <StatusBadge status={meeting.status} />
          <span className="w-full text-xs text-muted-foreground sm:w-auto">
            {formatWhen(meeting.scheduledAt ?? meeting.startedAt ?? meeting.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');

  const teams = useQuery({ queryKey: teamKeys.all, queryFn: listTeams });

  function onJoin(event: FormEvent) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code) navigate(`/app/room/${code}`);
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {user ? `Welcome back, ${user.name.split(' ')[0]}` : 'Welcome back'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start a meeting, join with a code, or pick up where your team left off.
        </p>
      </header>

      {/* A workspace with no team cannot hold a meeting, so say that plainly
          instead of showing a Start button that would only 404. */}
      {teams.isSuccess && teams.data.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users aria-hidden="true" className="size-5 text-primary" />
              Create your first team
            </CardTitle>
            <CardDescription>
              Meetings belong to a team, so that is the first step. It takes one field.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/app/teams">Create a team</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Video aria-hidden="true" className="size-5 text-primary" />
                Start a meeting
              </CardTitle>
              <CardDescription>
                Start now or schedule for later. Everyone in the team you pick is notified.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* The team picker lives in the dialog, so a workspace with
                  several teams no longer silently uses the first one. */}
              <CreateMeetingDialog />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock aria-hidden="true" className="size-5 text-primary" />
                Join with a code
              </CardTitle>
              <CardDescription>The 7-character code from a meeting invite.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onJoin} className="flex flex-col gap-2 sm:flex-row">
                <Label htmlFor="room-code" className="sr-only">
                  Room code
                </Label>
                <Input
                  id="room-code"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="T6G59G3"
                  autoCapitalize="characters"
                  className="uppercase"
                />
                <Button type="submit" variant="outline" disabled={!joinCode.trim()}>
                  Join
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      <section aria-labelledby="recent-meetings">
        <h2 id="recent-meetings" className="text-lg font-semibold tracking-tight">
          Recent meetings
        </h2>
        <div className="mt-3">
          <MeetingRows />
        </div>
      </section>
    </div>
  );
}
