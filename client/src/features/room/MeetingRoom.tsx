import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, AppWindow, Circle, Info, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { Meeting } from '@intellmeet/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SPEAKING_THRESHOLD, createLevelMeter, type LevelMeter } from '@/lib/webrtc/audioLevel';
import { getScreenStream, stopStream } from '@/lib/webrtc/devices';
import { useTeamPeople } from '@/features/mentions/useTeamPeople';
import { useAuthStore } from '@/stores/authStore';
import { ChatPanel } from './ChatPanel';
import { InviteDialog } from './InviteDialog';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RoomControls } from './RoomControls';
import { VideoGrid } from './VideoGrid';
import type { LocalMedia } from './useLocalMedia';
import { useMeetingRoom } from './useMeetingRoom';
import { useRecording } from './useRecording';
import { useRecordingIndicator } from './useRecordingIndicator';

interface Props {
  meeting: Meeting;
  media: LocalMedia;
  onLeft: () => void;
}

/** Number of peers above which a full mesh starts to struggle on typical uplinks. */
const MESH_SOFT_CAP = 6;

function useElapsed(since: string | null): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!since) return '00:00';

  const seconds = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

export function MeetingRoom({ meeting, media, onLeft }: Props) {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();

  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const [unread, setUnread] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // The host's "mute all" has to actually stop our track, which only the media
  // hook can do - so the room hook is handed a callback rather than the hook.
  const forceMute = useCallback(() => {
    if (media.audioEnabled) media.toggleAudio();
  }, [media]);

  const room = useMeetingRoom({ meeting, localStream: media.stream, onForceMute: forceMute });

  // Anyone in the team can be @mentioned in the chat, whether or not they
  // are in the room: they get a notification either way.
  const teamPeople = useTeamPeople(meeting.teamId);

  const isHost = room.self?.isHost ?? meeting.isHost;
  const indicator = useRecordingIndicator(meeting.id);

  // Only the host records, but the hook runs for everyone (hooks cannot be
  // conditional); for anyone else its controls are simply never shown.
  const recorder = useRecording({
    meetingId: meeting.id,
    localStream: media.stream,
    peers: room.peers,
    announce: indicator.announce,
  });
  const elapsed = useElapsed(meeting.startedAt);
  const sharingScreen = Boolean(screenStream);

  // --- Publishing our own media state --------------------------------------

  useEffect(() => {
    room.publishMediaState({
      audio: media.audioEnabled,
      video: media.videoEnabled && !media.audioOnly,
      screen: sharingScreen,
    });
    // `room` is recreated each render; only the flags should re-publish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.audioEnabled, media.videoEnabled, media.audioOnly, sharingScreen]);

  // --- Screen sharing ------------------------------------------------------

  const stopSharing = useCallback(async () => {
    setScreenStream((current) => {
      stopStream(current);
      return null;
    });

    // Put the camera back. `replaceTrack` keeps the same sender, so peers see
    // the switch without a renegotiation or a black frame.
    const cameraTrack = media.stream?.getVideoTracks()[0] ?? null;
    await room.transport?.replaceVideoTrack(cameraTrack);
  }, [media.stream, room.transport]);

  const toggleScreen = useCallback(() => {
    void (async () => {
      if (sharingScreen) {
        await stopSharing();
        return;
      }

      try {
        const stream = await getScreenStream();
        const track = stream.getVideoTracks()[0];
        if (!track) return;

        // The browser's own "Stop sharing" bar ends the track without telling
        // the page any other way. Without this the call would keep sending a
        // frozen last frame.
        track.addEventListener('ended', () => void stopSharing());

        await room.transport?.replaceVideoTrack(track);
        setScreenStream(stream);
      } catch (error) {
        // Cancelling the picker throws NotAllowedError; that is not an error
        // worth showing anyone.
        if (error instanceof DOMException && error.name === 'NotAllowedError') return;
        toast.error(error instanceof Error ? error.message : 'Could not share your screen.');
      }
    })();
  }, [sharingScreen, stopSharing, room.transport]);

  // --- Active speaker ------------------------------------------------------

  const peers = room.peers;

  useEffect(() => {
    const meters = new Map<string, LevelMeter>();

    if (media.stream) meters.set('self', createLevelMeter(media.stream));
    for (const peer of peers) {
      if (peer.stream) meters.set(peer.socketId, createLevelMeter(peer.stream));
    }

    // Polled a few times a second rather than every frame: this only decides
    // which tile gets a ring, and re-rendering the grid at 60fps to do it
    // would be pure waste.
    const timer = setInterval(() => {
      let loudest: string | null = null;
      let best = SPEAKING_THRESHOLD;

      for (const [id, meter] of meters) {
        const level = meter.read();
        if (level > best) {
          best = level;
          loudest = id;
        }
      }

      setActiveSpeaker((current) => (current === loudest ? current : loudest));
    }, 300);

    return () => {
      clearInterval(timer);
      for (const meter of meters.values()) meter.stop();
    };
  }, [media.stream, peers]);

  // --- Chat unread badge ---------------------------------------------------

  const messageCount = room.messages.length;
  const seenRef = useRef(0);

  useEffect(() => {
    if (tab === 'chat') {
      seenRef.current = messageCount;
      setUnread(0);
      return;
    }
    setUnread(messageCount - seenRef.current);
  }, [messageCount, tab]);

  // --- Leaving -------------------------------------------------------------

  const leave = useCallback(() => {
    // A recording in progress is saved, not discarded. The upload carries on
    // after the room unmounts; its toast reports how it went.
    if (recorder.phase === 'recording') void recorder.stop();
    stopStream(screenStream);
    room.leave();
    onLeft();
  }, [screenStream, room, onLeft, recorder]);

  const endForEveryone = useCallback(() => {
    // Stop first, so the last seconds are in the file before the room closes.
    if (recorder.phase === 'recording') void recorder.stop();
    room.endForEveryone();
    toast.success('Ending the meeting for everyone');
  }, [recorder, room]);

  // The host leaving is a decision, not a click. Nobody else can record, mute
  // everyone or end the meeting (there is no host migration: the host is also
  // who may correct the AI's minutes afterwards), so the host is asked whether
  // to end it or let the others carry on. Alone in the room, there is nothing
  // to decide: the idle sweep ends an empty meeting.
  const requestLeave = useCallback(() => {
    if (isHost && peers.length > 0) setConfirmingLeave(true);
    else leave();
  }, [isHost, peers.length, leave]);

  // Somebody is in the call without the host - they left, or have not come
  // back yet. The room says so, rather than leaving people to discover that
  // the host's controls are gone. Derived, so it clears the moment they return.
  const hostAway = room.phase === 'live' && !isHost && !peers.some((peer) => peer.isHost);

  // Another tab of this browser took the room over: this one stops sending.
  const replaced = room.phase === 'replaced';
  useEffect(() => {
    if (!replaced) return;
    if (recorder.phase === 'recording') void recorder.stop();
    setScreenStream((current) => {
      stopStream(current);
      return null;
    });
    // Once per takeover; `recorder` is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaced]);

  // A closed tab never runs React cleanup, so tell the room on the way out.
  useEffect(() => {
    const onUnload = () => room.leave();
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, [room]);

  if (room.phase === 'ended') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">The meeting has ended</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {meeting.hostName} ended it for everyone.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to={`/app/meetings/${meeting.id}`}>
              <Sparkles aria-hidden="true" />
              Summary and action items
            </Link>
          </Button>
          <Button variant="outline" onClick={() => navigate('/app')}>
            Back to the dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (replaced) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AppWindow aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          This meeting is open in another tab
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You joined it from another tab of this browser, so this one stepped out: two tabs in one
          call hear each other as an echo.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={room.rejoin}>Use this tab instead</Button>
          <Button variant="outline" onClick={onLeft}>
            Back to the dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (room.phase === 'error') {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle aria-hidden="true" className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Could not join</h1>
        <p className="mt-2 text-sm text-muted-foreground">{room.error}</p>
        <Button variant="outline" className="mt-6" onClick={() => navigate('/app')}>
          Back to the dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{meeting.title}</h1>
          <p className="text-xs text-muted-foreground">
            <span aria-label={`Elapsed time ${elapsed}`}>{elapsed}</span>
            {' · '}
            {peers.length + 1} in the room
          </p>
        </div>

        {/* Everyone sees this, not only the host: being recorded is something
            each participant has a right to know. A live region, so screen
            readers announce it as it starts and stops. */}
        <p role="status" aria-live="polite" className="text-sm">
          {indicator.recording && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 font-medium text-destructive">
              <Circle aria-hidden="true" className="size-2.5 animate-pulse fill-current" />
              Recording
            </span>
          )}
        </p>

        <InviteDialog meeting={meeting} />
      </header>

      {/* Only STUN configured: a direct path works on most home and office
          networks, but symmetric NAT and strict corporate firewalls need a
          relay. Saying so up front beats a tile that never appears. */}
      {!room.hasTurn && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            Running on STUN only. Calls work on most networks, but a strict corporate firewall or a
            mobile network behind symmetric NAT may not connect. Adding TURN credentials fixes it.
          </span>
        </p>
      )}

      {hostAway && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm"
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {meeting.hostName}, the host, is not in the call. It carries on without them, but only
            the host can record, mute everyone or end it for all. It ends by itself once everyone
            has left.
          </span>
        </p>
      )}

      {peers.length + 1 > MESH_SOFT_CAP && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <Users aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <span>
            {peers.length + 1} people in a peer-to-peer mesh. Video quality degrades above{' '}
            {MESH_SOFT_CAP}; turning off some cameras helps.
          </span>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <VideoGrid
            self={room.self}
            selfName={user?.name ?? 'You'}
            selfAvatarUrl={user?.avatarUrl ?? null}
            // While sharing, our own tile shows the screen - which is what the
            // others are receiving.
            selfStream={screenStream ?? media.stream}
            selfMedia={{
              audio: media.audioEnabled,
              video: sharingScreen || (media.videoEnabled && !media.audioOnly),
              screen: sharingScreen,
            }}
            peers={peers}
            activeSpeaker={activeSpeaker}
          />

          <RoomControls
            audioEnabled={media.audioEnabled}
            videoEnabled={media.videoEnabled}
            sharingScreen={sharingScreen}
            isHost={isHost}
            onToggleAudio={media.toggleAudio}
            onToggleVideo={media.toggleVideo}
            onToggleScreen={toggleScreen}
            onLeave={requestLeave}
            onMuteEveryone={room.muteEveryone}
            onEndForEveryone={endForEveryone}
            recording={
              isHost && recorder.supported
                ? {
                    phase: recorder.phase,
                    onToggle: () => {
                      if (recorder.phase === 'recording') void recorder.stop();
                      else recorder.start();
                    },
                  }
                : undefined
            }
          />
        </div>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as 'chat' | 'people')}
          className="flex h-[28rem] min-h-0 flex-col rounded-xl border bg-card lg:h-auto"
        >
          <TabsList className="m-2">
            <TabsTrigger value="chat">
              Chat
              {unread > 0 && (
                <Badge
                  variant="destructive"
                  className="ml-1 h-4 min-w-4 justify-center px-1 text-[10px]"
                >
                  {unread > 9 ? '9+' : unread}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="flex min-h-0 flex-col">
            <ChatPanel
              messages={room.messages}
              typingNames={room.typingNames}
              selfUserId={user?.id}
              onSend={room.sendChat}
              onTyping={room.notifyTyping}
              people={teamPeople}
            />
          </TabsContent>

          <TabsContent value="people" className="flex min-h-0 flex-col">
            <ParticipantsPanel
              self={room.self}
              selfName={user?.name ?? 'You'}
              selfAvatarUrl={user?.avatarUrl ?? null}
              selfAudioEnabled={media.audioEnabled}
              peers={peers}
              isHost={isHost}
              onMute={room.muteParticipant}
            />
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={confirmingLeave} onOpenChange={setConfirmingLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave the meeting?</DialogTitle>
            <DialogDescription>
              {peers.length === 1 ? 'Somebody is' : `${peers.length} people are`} still in the call.
              You can end it for everyone, or leave and let them carry on without you: only you can
              record, mute everyone or end it, and it ends by itself once everyone has left.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingLeave(false)}>
              Stay
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmingLeave(false);
                leave();
              }}
            >
              Leave, let them carry on
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingLeave(false);
                endForEveryone();
              }}
            >
              End for everyone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
