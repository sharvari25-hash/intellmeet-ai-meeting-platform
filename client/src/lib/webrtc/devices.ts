export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
}

export interface MediaRequest {
  audio: boolean;
  video: boolean;
  microphoneId?: string;
  cameraId?: string;
}

/**
 * Why a getUserMedia call failed, in words a person can act on.
 *
 * The browser's own messages are unhelpful ("Permission denied") or absent,
 * and the distinction matters: a blocked permission needs the address-bar
 * padlock, a missing device needs hardware, and a device already in use needs
 * the other application closed. Lumping them into "could not access camera"
 * leaves people stuck.
 */
export function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera and microphone access was blocked. Allow it from the padlock in the address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found. You can still join to listen and use chat.';
    case 'NotReadableError':
      return 'Your camera or microphone is already in use by another application. Close it and try again.';
    case 'AbortError':
      return 'The device stopped responding. Unplug and reconnect it, or pick another one.';
    default:
      return error instanceof Error && error.message
        ? error.message
        : 'Could not start your camera or microphone.';
  }
}

/**
 * True when the browser will allow camera and microphone access at all.
 *
 * `getUserMedia` only exists in a secure context - HTTPS, or localhost as a
 * special case. On a phone reaching a dev server by LAN IP over plain HTTP the
 * API is simply missing, which otherwise surfaces as a baffling
 * "Cannot read properties of undefined". See README for the HTTPS dev mode.
 */
export function mediaDevicesSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export async function getLocalStream(request: MediaRequest): Promise<MediaStream> {
  if (!mediaDevicesSupported()) {
    throw new Error(
      'This browser will not share a camera or microphone over an insecure connection. Use https:// or localhost.',
    );
  }

  const constraints: MediaStreamConstraints = {
    audio: request.audio
      ? request.microphoneId
        ? { deviceId: { exact: request.microphoneId } }
        : true
      : false,
    video: request.video
      ? {
          ...(request.cameraId ? { deviceId: { exact: request.cameraId } } : {}),
          // A request, not a demand: `ideal` lets the browser fall back to
          // whatever the camera actually supports instead of throwing
          // OverconstrainedError on hardware that cannot do 720p.
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        }
      : false,
  };

  return navigator.mediaDevices.getUserMedia(constraints);
}

/**
 * Lists cameras and microphones.
 *
 * Labels are empty until the user has granted permission at least once, which
 * is why this is called *after* the first `getUserMedia` rather than before -
 * otherwise the pickers read "Camera 1", "Camera 2".
 */
export async function listDevices(): Promise<DeviceLists> {
  if (!mediaDevicesSupported()) return { cameras: [], microphones: [] };

  const devices = await navigator.mediaDevices.enumerateDevices();

  return {
    cameras: devices.filter((device) => device.kind === 'videoinput'),
    microphones: devices.filter((device) => device.kind === 'audioinput'),
  };
}

/** Stops every track on a stream. Forgetting this leaves the camera light on. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** True when the browser can capture a screen or window at all (not on iOS). */
export function screenShareSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

export async function getScreenStream(): Promise<MediaStream> {
  if (!screenShareSupported()) {
    throw new Error('This browser cannot share a screen. Try a desktop browser.');
  }

  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 15 } },
    // Audio is deliberately not requested: it is Chrome-only, needs the user
    // to tick a box they usually miss, and echoes into the call when they do.
    audio: false,
  });
}
