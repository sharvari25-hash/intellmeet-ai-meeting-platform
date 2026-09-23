import type { MediaState, Participant } from '@intellmeet/shared';
import type { RemotePeer } from '@/lib/webrtc/types';
import { cn } from '@/lib/utils';
import { VideoTile } from './VideoTile';

interface Props {
  self: Participant | null;
  selfName: string;
  selfAvatarUrl: string | null;
  selfStream: MediaStream | null;
  selfMedia: MediaState;
  peers: RemotePeer[];
  /** Socket id of whoever is currently loudest, or 'self'. */
  activeSpeaker: string | null;
}

/**
 * Column count for a given number of tiles.
 *
 * Chosen by hand rather than by `auto-fit`, because `minmax` with a fixed
 * minimum gives four people a 2x2 at one width and a 4x1 at another - the
 * layout jumps around as somebody joins. Explicit breakpoints keep it
 * predictable, and the aspect ratio on each tile does the rest.
 */
function gridClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 6) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

export function VideoGrid({
  self,
  selfName,
  selfAvatarUrl,
  selfStream,
  selfMedia,
  peers,
  activeSpeaker,
}: Props) {
  const tileCount = peers.length + 1;

  return (
    <div className={cn('grid gap-3', gridClass(tileCount))}>
      <VideoTile
        name={selfName}
        avatarUrl={selfAvatarUrl}
        stream={selfStream}
        media={selfMedia}
        isSelf
        isHost={self?.isHost ?? false}
        isSpeaking={activeSpeaker === 'self'}
      />

      {peers.map((peer) => (
        <VideoTile
          key={peer.socketId}
          name={peer.name}
          avatarUrl={peer.avatarUrl}
          stream={peer.stream}
          media={peer.media}
          isHost={peer.isHost}
          isSpeaking={activeSpeaker === peer.socketId}
          connectionState={peer.connectionState}
        />
      ))}
    </div>
  );
}
