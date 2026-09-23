import { useEffect, useRef, useState } from 'react';
import { MicOff, MonitorUp, VideoOff, WifiOff } from 'lucide-react';
import type { MediaState } from '@intellmeet/shared';
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar';
import { Spinner } from '@/components/Spinner';
import { cn } from '@/lib/utils';

export interface VideoTileProps {
  name: string;
  avatarUrl: string | null;
  stream: MediaStream | null;
  media: MediaState;
  isSelf?: boolean;
  isHost?: boolean;
  isSpeaking?: boolean;
  connectionState?: RTCPeerConnectionState;
}

/**
 * One person's video.
 *
 * `srcObject` is assigned imperatively because it takes a `MediaStream`
 * object, not a URL - there is no way to express it as a React prop, and
 * `URL.createObjectURL(stream)` has been deprecated for years.
 */
export function VideoTile({
  name,
  avatarUrl,
  stream,
  media,
  isSelf = false,
  isHost = false,
  isSpeaking = false,
  connectionState,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Which stream has put a decoded frame on screen. Keyed by the stream rather
  // than a boolean so a replaced stream starts out "not yet" without a reset
  // effect.
  const [framesFrom, setFramesFrom] = useState<MediaStream | null>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    element.srcObject = stream;

    // A remote stream exists from the moment the offer is applied - long
    // before ICE connects and the first keyframe decodes. Showing the element
    // then gives a blank grey box. `videoWidth` is zero until a real frame has
    // been decoded, which makes it the honest signal.
    const onFrame = () => {
      if (element.videoWidth > 0) setFramesFrom(stream);
    };

    element.addEventListener('loadeddata', onFrame);
    element.addEventListener('resize', onFrame);
    onFrame();

    return () => {
      element.removeEventListener('loadeddata', onFrame);
      element.removeEventListener('resize', onFrame);
      // Dropping the reference lets the browser release the decoder when the
      // tile unmounts, rather than waiting for garbage collection.
      element.srcObject = null;
    };
  }, [stream]);

  const hasFrames = stream !== null && framesFrom === stream;
  const hasVideo = hasFrames && media.video;
  // Waiting on the network: their camera is on but nothing has decoded yet, or
  // the connection is not up. Once a frame has arrived, a later drop keeps the
  // last picture and shows the reconnecting icon instead; a peer with their
  // camera off shows their avatar once connected, not an endless spinner.
  const connecting = !isSelf && !hasFrames && (media.video || connectionState !== 'connected');
  const disconnected = connectionState === 'failed' || connectionState === 'disconnected';

  return (
    <div
      className={cn(
        'relative aspect-video min-w-0 overflow-hidden rounded-xl border bg-muted',
        // A ring rather than a border swap, so the tile does not resize by a
        // pixel every time somebody starts talking.
        isSpeaking && 'ring-2 ring-[var(--success)] ring-offset-2 ring-offset-background',
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // Muting our own tile is not cosmetic: without it the microphone feeds
        // back into the speakers and howls.
        muted={isSelf}
        // Lets the end-to-end suite tell the remote tiles from our own.
        data-tile={isSelf ? 'self' : 'remote'}
        className={cn('size-full object-cover', !hasVideo && 'invisible')}
      />

      {!hasVideo && (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar className="size-16">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
          </Avatar>
        </div>
      )}

      {connecting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60">
          <Spinner label={`Connecting to ${name}`} />
          <span aria-hidden="true" className="text-xs font-medium text-foreground">
            Connecting…
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">
          {name}
          {isSelf && ' (you)'}
          {isHost && ' · host'}
        </span>

        {/* Icons carry an accessible name each, because a muted microphone is
            information, not decoration. */}
        {media.screen && (
          <MonitorUp
            aria-label={`${name} is sharing their screen`}
            className="size-3.5 text-white"
          />
        )}
        {!media.audio && <MicOff aria-label={`${name} is muted`} className="size-3.5 text-white" />}
        {!media.video && (
          <VideoOff aria-label={`${name} has their camera off`} className="size-3.5 text-white" />
        )}
        {disconnected && (
          <WifiOff aria-label={`Reconnecting to ${name}`} className="size-3.5 text-destructive" />
        )}
      </div>
    </div>
  );
}
