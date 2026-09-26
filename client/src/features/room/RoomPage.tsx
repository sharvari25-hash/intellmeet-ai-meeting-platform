import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { INVITE_CODE_LENGTH, ROOM_CODE_LENGTH } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { getMeetingByCode, meetingKeys } from '@/features/meetings/meetings.api';
import { useAuthStore } from '@/stores/authStore';
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
    return (
      <RoomUnavailable
        error={meeting.error}
        roomCode={roomCode}
        onRetry={() => void meeting.refetch()}
      />
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

/**
 * Why a room code did not open a room, and what to do about it.
 *
 * Every one of these used to read "That meeting is not available", so a
 * working link sent to somebody outside the team looked exactly like a typo,
 * and nobody could tell which of the fixes below they needed.
 */
function RoomUnavailable({
  error,
  roomCode,
  onRetry,
}: {
  error: unknown;
  roomCode: string;
  onRetry: () => void;
}) {
  const isGuest = useAuthStore((state) => state.user?.authProvider === 'guest');
  const code = error instanceof ApiError ? error.code : null;

  let title: string;
  let body: ReactNode;
  let action: ReactNode = null;

  if (code === 'FORBIDDEN') {
    title = "You're not in this meeting's team";
    body = (
      <>
        <p>{(error as ApiError).message}</p>
        {/* Every Try Live Demo guest is in one team, so somebody who signed up
            instead can never be let into a demo meeting - but can still join
            it the way the host did. A guest seeing this already is one. */}
        {!isGuest && (
          <p>
            Is the host using Try Live Demo? Every demo guest is in the same team: sign out, open
            this link again and choose Try Live Demo.
          </p>
        )}
      </>
    );
  } else if (code === 'NOT_FOUND' || code === 'VALIDATION_ERROR') {
    title = 'No meeting has that code';
    const looksLikeInvite = roomCode.length === INVITE_CODE_LENGTH;
    body = looksLikeInvite ? (
      <p>
        Room codes have {ROOM_CODE_LENGTH} characters. {roomCode.toUpperCase()} has{' '}
        {INVITE_CODE_LENGTH}, like a team invite code.
      </p>
    ) : (
      <p>Check the code and try again. Room codes have {ROOM_CODE_LENGTH} characters.</p>
    );
    if (looksLikeInvite) {
      action = (
        <Button asChild>
          <Link to={`/join/${encodeURIComponent(roomCode)}`}>Use it as a team invite</Link>
        </Button>
      );
    }
  } else if (code === 'CONFLICT') {
    title = 'This meeting has ended';
    body = (
      <p>
        The host ended it, or it closed on its own after everyone had left. Its summary and action
        items are in the meeting history.
      </p>
    );
    action = (
      <Button asChild>
        <Link to="/app/meetings">Meeting history</Link>
      </Button>
    );
  } else {
    title = 'Could not open the meeting';
    body = (
      <p>{error instanceof ApiError ? error.message : 'Check your connection and try again.'}</p>
    );
    action = <Button onClick={onRetry}>Try again</Button>;
  }

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <AlertTriangle aria-hidden="true" className="mx-auto size-8 text-destructive" />
      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{body}</div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {action}
        <Button asChild variant="outline">
          <Link to="/app">Back to the dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
