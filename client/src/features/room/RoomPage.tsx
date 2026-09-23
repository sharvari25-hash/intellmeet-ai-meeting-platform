import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { getMeetingByCode, meetingKeys } from '@/features/meetings/meetings.api';
import { Lobby } from './Lobby';
import { MeetingRoom } from './MeetingRoom';
import { useLocalMedia } from './useLocalMedia';

/**
 * The meeting route.
 *
 * Two phases behind one URL: the lobby, then the room. They are separate
 * components rather than one with a flag because they want different things -
 * the lobby owns a preview and device pickers, the room owns peer connections
 * - and the only state they share is the local media stream, which is held
 * here so that stream survives the transition instead of being re-acquired
 * (and re-prompting for permission) the moment somebody presses Join.
 */
export function RoomPage() {
  const { roomCode = '' } = useParams();
  const navigate = useNavigate();
  const [joined, setJoined] = useState(false);

  const meeting = useQuery({
    queryKey: meetingKeys.byCode(roomCode),
    queryFn: () => getMeetingByCode(roomCode),
    enabled: Boolean(roomCode),
    // The room code resolves to a meeting whose status matters: rejoining an
    // ended meeting should fail, not serve a stale cache entry.
    staleTime: 0,
    retry: false,
  });

  // Acquire the camera as soon as the meeting resolves, so the permission
  // prompt and the lobby appear together rather than one after the other.
  const media = useLocalMedia(meeting.isSuccess);

  if (meeting.isPending) {
    return (
      <div aria-live="polite" className="mx-auto w-full max-w-4xl space-y-4">
        <span className="sr-only">Loading the meeting</span>
        <Skeleton className="mx-auto h-8 w-64" />
        <Skeleton className="aspect-video w-full" />
      </div>
    );
  }

  if (meeting.isError) {
    const isGone =
      meeting.error instanceof ApiError &&
      (meeting.error.code === 'NOT_FOUND' || meeting.error.code === 'CONFLICT');

    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle aria-hidden="true" className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {isGone ? 'That meeting is not available' : 'Could not open the meeting'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {meeting.error instanceof ApiError
            ? meeting.error.message
            : 'Check the room code and try again.'}
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/app">Back to the dashboard</Link>
        </Button>
      </div>
    );
  }

  if (!joined) {
    return <Lobby meeting={meeting.data} media={media} onJoin={() => setJoined(true)} />;
  }

  return (
    <MeetingRoom
      meeting={meeting.data}
      media={media}
      onLeft={() => {
        setJoined(false);
        navigate('/app');
      }}
    />
  );
}
