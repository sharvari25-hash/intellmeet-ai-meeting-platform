import { useEffect, useRef } from 'react';
import { AlertTriangle, Mic, MicOff, RefreshCw, Video, VideoOff } from 'lucide-react';
import type { Meeting } from '@intellmeet/shared';
import { Spinner } from '@/components/Spinner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select-native';
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar';
import { useAuthStore } from '@/stores/authStore';
import type { LocalMedia } from './useLocalMedia';
import { MicMeter } from './MicMeter';

interface Props {
  meeting: Meeting;
  media: LocalMedia;
  onJoin: () => void;
}

/**
 * The check-your-hair screen.
 *
 * Every conferencing product has one for the same reason: the first thirty
 * seconds of a call are otherwise spent discovering that the wrong microphone
 * is selected. Choosing devices here also means the peer connections are
 * created once, with the right tracks, rather than renegotiated moments later.
 */
export function Lobby({ meeting, media, onJoin }: Props) {
  const user = useAuthStore((state) => state.user);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = media.stream;
  }, [media.stream]);

  const name = user?.name ?? 'You';

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{meeting.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hosted by {meeting.hostName} · room {meeting.roomCode}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            // Mirrored, because a preview of yourself that moves the wrong way
            // when you wave is disorienting. Only the preview - what peers
            // receive is never flipped.
            className={`size-full -scale-x-100 object-cover ${
              media.videoEnabled && media.stream && !media.audioOnly ? '' : 'invisible'
            }`}
          />

          {media.starting && (
            <div className="absolute inset-0 grid place-items-center">
              <Spinner label="Starting your camera" />
            </div>
          )}

          {!media.starting && (!media.videoEnabled || media.audioOnly || !media.stream) && (
            <div className="absolute inset-0 grid place-items-center">
              <Avatar className="size-20">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="text-2xl">{initials(name)}</AvatarFallback>
              </Avatar>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 p-3">
            <Button
              variant={media.audioEnabled ? 'secondary' : 'destructive'}
              size="icon"
              aria-label={
                media.audioEnabled ? 'Turn your microphone off' : 'Turn your microphone on'
              }
              aria-pressed={!media.audioEnabled}
              onClick={media.toggleAudio}
            >
              {media.audioEnabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
            </Button>
            <Button
              variant={media.videoEnabled ? 'secondary' : 'destructive'}
              size="icon"
              aria-label={media.videoEnabled ? 'Turn your camera off' : 'Turn your camera on'}
              aria-pressed={!media.videoEnabled}
              onClick={media.toggleVideo}
              disabled={media.audioOnly}
            >
              {media.videoEnabled ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="camera">Camera</Label>
            <NativeSelect
              id="camera"
              value={media.cameraId ?? ''}
              disabled={media.devices.cameras.length === 0}
              onChange={(event) => media.setCamera(event.target.value)}
            >
              {media.devices.cameras.length === 0 && <option value="">No camera found</option>}
              {media.devices.cameras.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="microphone">Microphone</Label>
            <NativeSelect
              id="microphone"
              value={media.microphoneId ?? ''}
              disabled={media.devices.microphones.length === 0}
              onChange={(event) => media.setMicrophone(event.target.value)}
            >
              {media.devices.microphones.length === 0 && (
                <option value="">No microphone found</option>
              )}
              {media.devices.microphones.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </NativeSelect>
            <MicMeter stream={media.stream} enabled={media.audioEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="display-name">Joining as</Label>
            {/* Read-only: the name peers see is the account's, changed in
                Settings, so that one edit applies everywhere rather than
                per meeting. */}
            <p
              id="display-name"
              className="flex h-9 items-center rounded-md border border-input px-3 text-sm"
            >
              {name}
            </p>
          </div>

          {media.error && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {media.error}
              </p>
              <Button variant="outline" size="sm" onClick={media.retry}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          )}

          {/* Joining without media is allowed on purpose: somebody on a
              locked-down laptop can still watch and use chat. */}
          <Button className="w-full" size="lg" onClick={onJoin} disabled={media.starting}>
            Join meeting
          </Button>
        </div>
      </div>
    </div>
  );
}
