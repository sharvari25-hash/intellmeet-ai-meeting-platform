import { MicOff, VolumeX } from 'lucide-react';
import type { Participant } from '@intellmeet/shared';
import type { RemotePeer } from '@/lib/webrtc/types';
import { Avatar, AvatarFallback, AvatarImage, initials } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface Props {
  self: Participant | null;
  selfName: string;
  selfAvatarUrl: string | null;
  selfAudioEnabled: boolean;
  peers: RemotePeer[];
  isHost: boolean;
  onMute: (userId: string) => void;
}

function Row({
  name,
  avatarUrl,
  muted,
  isHost,
  isSelf,
  connecting,
  action,
}: {
  name: string;
  avatarUrl: string | null;
  muted: boolean;
  isHost: boolean;
  isSelf?: boolean;
  connecting?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Avatar className="size-8">
        {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
        <AvatarFallback>{initials(name)}</AvatarFallback>
      </Avatar>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {name}
          {isSelf && <span className="text-muted-foreground"> (you)</span>}
        </span>
        {connecting && <span className="block text-xs text-muted-foreground">Connecting…</span>}
      </span>

      {isHost && <Badge variant="secondary">Host</Badge>}
      {muted && <MicOff aria-label={`${name} is muted`} className="size-4 text-muted-foreground" />}
      {action}
    </li>
  );
}

export function ParticipantsPanel({
  self,
  selfName,
  selfAvatarUrl,
  selfAudioEnabled,
  peers,
  isHost,
  onMute,
}: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        In the room · {peers.length + 1}
      </p>

      <ul className="divide-y">
        <Row
          name={selfName}
          avatarUrl={selfAvatarUrl}
          muted={!selfAudioEnabled}
          isHost={self?.isHost ?? false}
          isSelf
        />

        {peers.map((peer) => (
          <Row
            key={peer.socketId}
            name={peer.name}
            avatarUrl={peer.avatarUrl}
            muted={!peer.media.audio}
            isHost={peer.isHost}
            connecting={peer.connectionState !== 'connected'}
            action={
              // Host-only, and never against the host themselves. The server
              // enforces this too - hiding it here is a courtesy.
              isHost && !peer.isHost ? (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Mute ${peer.name}`}
                  onClick={() => onMute(peer.userId)}
                >
                  <VolumeX aria-hidden="true" />
                </Button>
              ) : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}
