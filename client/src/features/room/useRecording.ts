import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { uploadRecording } from '@/features/meetings/ai.api';
import { invalidateAiQueries } from '@/features/meetings/useAiStatusUpdates';
import { MeetingRecorder, recordingSupported, type FinishedRecording } from '@/lib/webrtc/recorder';
import type { RemotePeer } from '@/lib/webrtc/types';

export type RecordingPhase = 'idle' | 'recording' | 'saving';

export interface Recording {
  /** False where the browser has no MediaRecorder or Web Audio: the button is hidden. */
  supported: boolean;
  phase: RecordingPhase;
  start: () => void;
  /** Stops and uploads. Resolves when the upload has finished (or failed). */
  stop: () => Promise<void>;
}

interface Options {
  meetingId: string;
  localStream: MediaStream | null;
  peers: RemotePeer[];
  /** Tells the room, so every participant sees the indicator. */
  announce: (recording: boolean) => void;
}

/**
 * The host's recording control.
 *
 * Owns a `MeetingRecorder` while recording, keeps its mix in step with who is
 * in the call, and on stop uploads the file - which is what queues the AI job.
 * Upload failures keep the file in memory and offer a retry, because the
 * alternative is silently throwing away the only copy of the meeting.
 */
export function useRecording({ meetingId, localStream, peers, announce }: Options): Recording {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<RecordingPhase>('idle');
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const [supported] = useState(recordingSupported);

  // Everyone's audio, keyed so the recorder can tell who joined and who left.
  const streamsRef = useRef(new Map<string, MediaStream>());
  useEffect(() => {
    const streams = new Map<string, MediaStream>();
    if (localStream) streams.set('self', localStream);
    for (const peer of peers) if (peer.stream) streams.set(peer.socketId, peer.stream);

    streamsRef.current = streams;
    recorderRef.current?.setStreams(streams);
  }, [localStream, peers]);

  const upload = useCallback(
    async (recording: FinishedRecording): Promise<void> => {
      try {
        await uploadRecording(meetingId, recording);
        // Narrowly: the room's own by-code query must not refetch, or an ended
        // meeting would swap the "meeting has ended" screen for a 409.
        void invalidateAiQueries(queryClient);
        toast.success('Recording saved', {
          description: 'The transcript and summary will appear on the meeting page in a moment.',
        });
      } catch (error) {
        toast.error('The recording could not be uploaded', {
          description: error instanceof Error ? error.message : undefined,
          // Keep the only copy reachable instead of dropping it.
          duration: Infinity,
          action: { label: 'Retry', onClick: () => void upload(recording) },
        });
      }
    },
    [meetingId, queryClient],
  );

  const start = useCallback(() => {
    if (recorderRef.current) return;

    try {
      const recorder = new MeetingRecorder();
      recorder.setStreams(streamsRef.current);
      recorder.start();
      recorderRef.current = recorder;
      setPhase('recording');
      announce(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not start recording.');
    }
  }, [announce]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    recorderRef.current = null;

    announce(false);
    setPhase('saving');

    try {
      const finished = await recorder.stop();
      await upload(finished);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The recording could not be saved.');
    } finally {
      setPhase('idle');
    }
  }, [announce, upload]);

  // Leaving the page mid-recording (closing the room, navigating away) still
  // saves what was recorded. The upload outlives the component: it is a
  // promise, not state, and nothing it does afterwards touches this hook.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => void stopRef.current(), []);

  return { supported, phase, start, stop };
}
