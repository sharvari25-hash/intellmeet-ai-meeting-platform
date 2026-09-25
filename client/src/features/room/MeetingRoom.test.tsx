import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Participant } from '@intellmeet/shared';
import type { RemotePeer } from '@/lib/webrtc/types';
import { GRACE_ID, HOST_ID, meeting } from '@/test/meetingFixtures';
import { renderWithProviders } from '@/test/utils';
import { MeetingRoom } from './MeetingRoom';
import type { LocalMedia } from './useLocalMedia';
import type { MeetingRoom as Room } from './useMeetingRoom';

/**
 * The room screen's own decisions: what the host is asked on the way out,
 * what the others are told when the host is gone, and what a tab that was
 * replaced by another shows. The socket, the mesh and the recorder behind it
 * have tests of their own, so here they are stand-ins.
 */

const current = vi.hoisted(() => ({ room: null as unknown as Room }));

vi.mock('./useMeetingRoom', () => ({ useMeetingRoom: () => current.room }));
vi.mock('./useRecording', () => ({
  useRecording: () => ({ supported: true, phase: 'idle', start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('./useRecordingIndicator', () => ({
  useRecordingIndicator: () => ({ recording: false, announce: vi.fn() }),
}));
vi.mock('@/features/mentions/useTeamPeople', () => ({ useTeamPeople: () => [] }));

const MEDIA_STATE = { audio: true, video: true, screen: false };

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    socketId: 'self-socket',
    userId: HOST_ID,
    name: 'Demo User',
    avatarUrl: null,
    isHost: true,
    media: MEDIA_STATE,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function peer(overrides: Partial<RemotePeer> = {}): RemotePeer {
  return {
    ...participant({ socketId: 'grace-socket', userId: GRACE_ID, name: 'Grace Hopper' }),
    isHost: false,
    stream: null,
    connectionState: 'connected',
    ...overrides,
  };
}

function fakeRoom(overrides: Partial<Room> = {}): Room {
  return {
    phase: 'live',
    error: null,
    peers: [],
    self: participant(),
    messages: [],
    typingNames: [],
    hasTurn: true,
    transport: null,
    sendChat: vi.fn(),
    notifyTyping: vi.fn(),
    publishMediaState: vi.fn(),
    muteEveryone: vi.fn(),
    muteParticipant: vi.fn(),
    endForEveryone: vi.fn(),
    leave: vi.fn(),
    rejoin: vi.fn(),
    ...overrides,
  };
}

const media = {
  stream: null,
  devices: { cameras: [], microphones: [] },
  cameraId: undefined,
  microphoneId: undefined,
  audioEnabled: true,
  videoEnabled: true,
  error: null,
  starting: false,
  audioOnly: false,
  setCamera: vi.fn(),
  setMicrophone: vi.fn(),
  toggleAudio: vi.fn(),
  toggleVideo: vi.fn(),
  retry: vi.fn(),
} as unknown as LocalMedia;

function renderRoom(room: Room) {
  current.room = room;
  const onLeft = vi.fn();
  const result = renderWithProviders(
    <MeetingRoom
      meeting={meeting({ status: 'live', endedAt: null })}
      media={media}
      onLeft={onLeft}
    />,
  );
  return { ...result, onLeft };
}

describe('<MeetingRoom />', () => {
  beforeEach(() => {
    current.room = fakeRoom();
    // jsdom does no layout, so it has no scrollIntoView (the chat panel's).
    Element.prototype.scrollIntoView = vi.fn();
  });

  describe('when the host leaves', () => {
    it('asks whether to end the meeting or let the others carry on', async () => {
      const room = fakeRoom({ peers: [peer()] });
      const { user, onLeft } = renderRoom(room);

      await user.click(screen.getByRole('button', { name: 'Leave' }));
      const dialog = await screen.findByRole('dialog', { name: 'Leave the meeting?' });
      expect(dialog).toHaveTextContent('Somebody is still in the call');

      await user.click(screen.getByRole('button', { name: 'Leave, let them carry on' }));

      expect(room.leave).toHaveBeenCalledOnce();
      expect(onLeft).toHaveBeenCalledOnce();
      expect(room.endForEveryone).not.toHaveBeenCalled();
    });

    it('ends it for everyone from the same question', async () => {
      const room = fakeRoom({ peers: [peer(), peer({ socketId: 'third', name: 'Alan Turing' })] });
      const { user, onLeft } = renderRoom(room);

      await user.click(screen.getByRole('button', { name: 'Leave' }));
      expect(await screen.findByRole('dialog', { name: 'Leave the meeting?' })).toHaveTextContent(
        '2 people are still in the call',
      );
      await user.click(screen.getByRole('button', { name: 'End for everyone' }));

      expect(room.endForEveryone).toHaveBeenCalledOnce();
      expect(room.leave).not.toHaveBeenCalled();
      expect(onLeft).not.toHaveBeenCalled();
    });

    it('lets them change their mind', async () => {
      const room = fakeRoom({ peers: [peer()] });
      const { user, onLeft } = renderRoom(room);

      await user.click(screen.getByRole('button', { name: 'Leave' }));
      await user.click(await screen.findByRole('button', { name: 'Stay' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(room.leave).not.toHaveBeenCalled();
      expect(onLeft).not.toHaveBeenCalled();
    });

    it('does not ask a host who is alone in the room', async () => {
      const room = fakeRoom();
      const { user, onLeft } = renderRoom(room);

      await user.click(screen.getByRole('button', { name: 'Leave' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(room.leave).toHaveBeenCalledOnce();
      expect(onLeft).toHaveBeenCalledOnce();
    });

    it('does not ask anyone who is not the host', async () => {
      const room = fakeRoom({
        self: participant({ userId: GRACE_ID, isHost: false }),
        peers: [peer({ userId: HOST_ID, name: 'Demo User', isHost: true })],
      });
      const { user } = renderRoom(room);

      await user.click(screen.getByRole('button', { name: 'Leave' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(room.leave).toHaveBeenCalledOnce();
    });
  });

  it('tells the others while the host is away, and stops once they are back', () => {
    const guest = participant({ userId: GRACE_ID, isHost: false });
    const away = fakeRoom({ self: guest, peers: [peer({ socketId: 'alan', name: 'Alan' })] });
    const { unmount } = renderRoom(away);

    // A status region, so a screen reader announces it as it appears.
    const notice = screen.getByText(/Demo User, the host, is not in the call/);
    expect(notice.closest('[role="status"]')).not.toBeNull();
    unmount();

    // Derived from who is in the room, so the host's return is all it takes.
    renderRoom(
      fakeRoom({
        self: guest,
        peers: [peer({ socketId: 'alan', name: 'Alan' }), peer({ userId: HOST_ID, isHost: true })],
      }),
    );
    expect(screen.queryByText(/the host, is not in the call/)).not.toBeInTheDocument();
  });

  it('never tells the host that the host is away', () => {
    renderRoom(fakeRoom({ peers: [peer()] }));

    expect(screen.queryByText(/the host, is not in the call/)).not.toBeInTheDocument();
  });

  it('says so when another tab took the meeting over, and takes it back on request', async () => {
    const room = fakeRoom({ phase: 'replaced', self: null });
    const { user, onLeft } = renderRoom(room);

    expect(
      screen.getByRole('heading', { name: 'This meeting is open in another tab' }),
    ).toBeInTheDocument();
    // Nothing of the call is left on screen to press.
    expect(screen.queryByRole('button', { name: 'Leave' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use this tab instead' }));
    expect(room.rejoin).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Back to the dashboard' }));
    expect(onLeft).toHaveBeenCalledOnce();
  });
});
