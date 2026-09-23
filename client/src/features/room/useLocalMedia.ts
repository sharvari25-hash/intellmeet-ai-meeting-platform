import { useCallback, useEffect, useRef, useState } from 'react';
import {
  describeMediaError,
  getLocalStream,
  listDevices,
  mediaDevicesSupported,
  stopStream,
  type DeviceLists,
} from '@/lib/webrtc/devices';

export interface LocalMedia {
  stream: MediaStream | null;
  devices: DeviceLists;
  cameraId: string | undefined;
  microphoneId: string | undefined;
  audioEnabled: boolean;
  videoEnabled: boolean;
  /** Null when the camera and microphone started cleanly. */
  error: string | null;
  /** True while a getUserMedia call is outstanding. */
  starting: boolean;
  /** True when we have a stream but no camera in it - audio-only fallback. */
  audioOnly: boolean;
  setCamera: (deviceId: string) => void;
  setMicrophone: (deviceId: string) => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  retry: () => void;
}

/**
 * Owns the local camera and microphone.
 *
 * Toggling mutes a track rather than stopping it. A stopped track has to be
 * re-acquired and renegotiated with every peer - a visible stall and a
 * flicker of the camera light - whereas `track.enabled = false` stops the
 * media instantly while leaving the sender in place, which is exactly what
 * every conferencing product does.
 *
 * Failure is graceful by design. Somebody with no webcam, or who declines the
 * camera prompt but not the microphone, should still get into the room: the
 * hook falls back to audio-only, then to no media at all, and reports which
 * happened rather than refusing to continue.
 */
export function useLocalMedia(enabled: boolean): LocalMedia {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], microphones: [] });
  const [cameraId, setCameraId] = useState<string>();
  const [microphoneId, setMicrophoneId] = useState<string>();
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The stream the effect is currently responsible for, so a device change can
  // stop the previous one without waiting for React state to settle.
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const start = async (): Promise<void> => {
      setStarting(true);
      setError(null);

      if (!mediaDevicesSupported()) {
        setError(
          'This browser will not share a camera or microphone over an insecure connection. Open the app on https:// or localhost - see the README for testing from a phone.',
        );
        setStarting(false);
        return;
      }

      let next: MediaStream | null = null;
      let failure: string | null = null;

      try {
        next = await getLocalStream({ audio: true, video: true, cameraId, microphoneId });
      } catch (cameraError) {
        // Most often: no webcam, or the camera prompt was declined while the
        // microphone was allowed. Being able to talk is better than nothing.
        try {
          next = await getLocalStream({ audio: true, video: false, microphoneId });
          failure = `${describeMediaError(cameraError)} You have joined with audio only.`;
        } catch (audioError) {
          failure = describeMediaError(audioError);
        }
      }

      if (cancelled) {
        stopStream(next);
        return;
      }

      // Swap after the new stream exists, so the preview never goes black
      // between devices.
      stopStream(streamRef.current);
      streamRef.current = next;
      setStream(next);
      setError(failure);
      setStarting(false);

      if (next) {
        // Apply the current toggles to the freshly acquired tracks.
        next.getAudioTracks().forEach((track) => (track.enabled = audioEnabled));
        next.getVideoTracks().forEach((track) => (track.enabled = videoEnabled));

        // Only now do device labels exist; before permission they are blank.
        setDevices(await listDevices());
      }
    };

    void start();

    return () => {
      cancelled = true;
    };
    // `audioEnabled`/`videoEnabled` are read but must not re-acquire the
    // stream - toggling a track is handled below without a new getUserMedia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cameraId, microphoneId, attempt]);

  // Release the camera when the component using it goes away. Without this the
  // camera light stays on after leaving the meeting.
  useEffect(
    () => () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    },
    [],
  );

  const toggleAudio = useCallback(() => {
    setAudioEnabled((wasEnabled) => {
      const nowEnabled = !wasEnabled;
      streamRef.current?.getAudioTracks().forEach((track) => (track.enabled = nowEnabled));
      return nowEnabled;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((wasEnabled) => {
      const nowEnabled = !wasEnabled;
      streamRef.current?.getVideoTracks().forEach((track) => (track.enabled = nowEnabled));
      return nowEnabled;
    });
  }, []);

  return {
    stream,
    devices,
    cameraId,
    microphoneId,
    audioEnabled,
    videoEnabled,
    error,
    starting,
    audioOnly: Boolean(stream) && stream?.getVideoTracks().length === 0,
    setCamera: setCameraId,
    setMicrophone: setMicrophoneId,
    toggleAudio,
    toggleVideo,
    retry: () => setAttempt((count) => count + 1),
  };
}
