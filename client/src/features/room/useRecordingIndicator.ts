import { useCallback, useEffect, useState } from 'react';
import { SOCKET_EVENTS } from '@intellmeet/shared';
import { useSocketStore } from '@/stores/socketStore';

export interface RecordingIndicator {
  /** True while the host is recording - drives the badge everyone sees. */
  recording: boolean;
  /** Host only: tells the room recording started or stopped. */
  announce: (recording: boolean) => void;
}

/**
 * Whether this meeting is being recorded, as every participant sees it.
 *
 * Its own hook rather than more state in `useMeetingRoom`: it is a separate
 * concern with its own two events, and nothing about the mesh depends on it.
 *
 * The state comes from the server, never from the local recorder, so the
 * host's badge and everyone else's are driven by the same broadcast. The
 * roster carries the current value too, so somebody who joins mid-recording
 * is told straight away rather than at the next start or stop.
 */
export function useRecordingIndicator(meetingId: string): RecordingIndicator {
  const socket = useSocketStore((state) => state.socket);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const onState = (raw: unknown) => {
      const data = raw as { meetingId: string; recording: boolean };
      if (data.meetingId === meetingId) setRecording(data.recording);
    };

    // The same roster event the room hook uses to build the mesh; a second
    // listener is cheaper than threading the flag through it.
    const onRoster = (raw: unknown) => {
      const data = raw as { meetingId: string; recording?: boolean };
      if (data.meetingId === meetingId) setRecording(Boolean(data.recording));
    };

    socket.on(SOCKET_EVENTS.RECORDING_STATE, onState);
    socket.on(SOCKET_EVENTS.ROOM_PARTICIPANTS, onRoster);
    return () => {
      socket.off(SOCKET_EVENTS.RECORDING_STATE, onState);
      socket.off(SOCKET_EVENTS.ROOM_PARTICIPANTS, onRoster);
    };
  }, [socket, meetingId]);

  const announce = useCallback(
    (next: boolean) => {
      socket?.emit(SOCKET_EVENTS.RECORDING_STATE, { meetingId, recording: next });
    },
    [socket, meetingId],
  );

  return { recording, announce };
}
