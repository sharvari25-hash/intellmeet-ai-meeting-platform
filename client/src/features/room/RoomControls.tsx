import {
  Circle,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Square,
  Video,
  VideoOff,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { screenShareSupported } from '@/lib/webrtc/devices';

interface Props {
  audioEnabled: boolean;
  videoEnabled: boolean;
  sharingScreen: boolean;
  isHost: boolean;
  onToggleAudio: () => void;
  onToggleVideo: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
  onMuteEveryone: () => void;
  onEndForEveryone: () => void;
  /** The host's recording control; omitted where recording is unsupported. */
  recording?: {
    phase: 'idle' | 'recording' | 'saving';
    onToggle: () => void;
  };
}

/**
 * The control bar.
 *
 * Every button is a real `<button>` with an `aria-label` that states the
 * action, not the state: a screen-reader user hears "Turn your microphone
 * off", which is what pressing it will do, rather than "Microphone on", which
 * they would have to interpret.
 */
export function RoomControls({
  audioEnabled,
  videoEnabled,
  sharingScreen,
  isHost,
  onToggleAudio,
  onToggleVideo,
  onToggleScreen,
  onLeave,
  onMuteEveryone,
  onEndForEveryone,
  recording,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border bg-card p-2">
      <Button
        variant={audioEnabled ? 'secondary' : 'destructive'}
        size="icon"
        aria-label={audioEnabled ? 'Turn your microphone off' : 'Turn your microphone on'}
        aria-pressed={!audioEnabled}
        onClick={onToggleAudio}
      >
        {audioEnabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
      </Button>

      <Button
        variant={videoEnabled ? 'secondary' : 'destructive'}
        size="icon"
        aria-label={videoEnabled ? 'Turn your camera off' : 'Turn your camera on'}
        aria-pressed={!videoEnabled}
        onClick={onToggleVideo}
      >
        {videoEnabled ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
      </Button>

      {/* iOS has no getDisplayMedia at all, so the button is hidden rather
          than offered and then failing. */}
      {screenShareSupported() && (
        <Button
          variant={sharingScreen ? 'default' : 'secondary'}
          size="icon"
          aria-label={sharingScreen ? 'Stop sharing your screen' : 'Share your screen'}
          aria-pressed={sharingScreen}
          onClick={onToggleScreen}
        >
          {sharingScreen ? <MonitorX aria-hidden="true" /> : <MonitorUp aria-hidden="true" />}
        </Button>
      )}

      {isHost && (
        <>
          <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
          {recording && (
            <Button
              variant={recording.phase === 'recording' ? 'destructive' : 'outline'}
              size="sm"
              aria-pressed={recording.phase === 'recording'}
              disabled={recording.phase === 'saving'}
              onClick={recording.onToggle}
            >
              {recording.phase === 'saving' ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : recording.phase === 'recording' ? (
                <Square aria-hidden="true" className="fill-current" />
              ) : (
                <Circle aria-hidden="true" className="fill-destructive text-destructive" />
              )}
              {recording.phase === 'saving'
                ? 'Saving recording…'
                : recording.phase === 'recording'
                  ? 'Stop recording'
                  : 'Record'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onMuteEveryone}>
            <VolumeX aria-hidden="true" />
            Mute all
          </Button>
          <Button variant="outline" size="sm" onClick={onEndForEveryone}>
            End for all
          </Button>
        </>
      )}

      <Button variant="destructive" size="sm" className="ml-auto sm:ml-2" onClick={onLeave}>
        <PhoneOff aria-hidden="true" />
        Leave
      </Button>
    </div>
  );
}
