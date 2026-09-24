import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { SOCKET_EVENTS, type Meeting } from '@intellmeet/shared';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import { useMeetingRoom } from './useMeetingRoom';

/** Lets the ICE and chat-history queries settle inside act(). */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

vi.mock('./ice.api', () => ({
  iceKeys: { servers: ['rtc', 'ice-servers'] },
  fetchIceServers: vi.fn(async () => ({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    hasTurn: false,
  })),
}));

vi.mock('@/features/meetings/meetings.api', () => ({
  messageKeys: { history: (id: string) => ['meetings', id, 'messages'] },
  getMessageHistory: vi.fn(async () => ({ messages: [], nextCursor: null })),
}));

const MEETING: Meeting = {
  id: '507f1f77bcf86cd799439011',
  teamId: '507f1f77bcf86cd799439012',
  title: 'Sprint review',
  description: null,
  hostId: '507f1f77bcf86cd799439013',
  hostName: 'Ada Lovelace',
  status: 'live',
  roomCode: 'ABC2345',
  scheduledAt: null,
  startedAt: new Date().toISOString(),
  endedAt: null,
  durationSec: null,
  participants: [],
  recording: null,
  aiStatus: 'none',
  isHost: true,
  createdAt: new Date().toISOString(),
};

function fakeSocket() {
  const emitted: string[] = [];
  return {
    emitted,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn((event: string) => {
      emitted.push(event);
    }),
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

let socket: ReturnType<typeof fakeSocket>;

beforeEach(() => {
  socket = fakeSocket();
  useSocketStore.setState({ socket: socket as never });
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: {
      id: '507f1f77bcf86cd799439013',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarUrl: null,
      role: 'member',
      authProvider: 'local',
      createdAt: new Date().toISOString(),
    },
  });
});

afterEach(() => {
  // Runs before the global cleanup unmounts the hook, so the store change
  // re-renders it.
  act(() => useSocketStore.setState({ socket: null }));
});

describe('useMeetingRoom', () => {
  it('stays in the room when the force-mute callback changes identity', async () => {
    const { rerender } = renderHook(
      ({ onForceMute }: { onForceMute: () => void }) =>
        useMeetingRoom({ meeting: MEETING, localStream: null, onForceMute }),
      { wrapper, initialProps: { onForceMute: () => {} } },
    );

    await settle();
    await settle();
    expect(socket.emitted).toContain(SOCKET_EVENTS.ROOM_JOIN);

    // The page builds this callback from its media object, which is new on
    // every render - toggling the microphone is enough. Each new identity used
    // to leave and rejoin the room, rebuilding every peer connection.
    rerender({ onForceMute: () => {} });
    rerender({ onForceMute: () => {} });

    expect(socket.emitted.filter((event) => event === SOCKET_EVENTS.ROOM_JOIN)).toHaveLength(1);
    expect(socket.emitted).not.toContain(SOCKET_EVENTS.ROOM_LEAVE);
  });

  it('calls the latest force-mute callback when the host mutes everyone', async () => {
    const first = vi.fn();
    const latest = vi.fn();

    const { rerender } = renderHook(
      ({ onForceMute }: { onForceMute: () => void }) =>
        useMeetingRoom({ meeting: MEETING, localStream: null, onForceMute }),
      { wrapper, initialProps: { onForceMute: first } },
    );

    await settle();
    await settle();
    expect(socket.emitted).toContain(SOCKET_EVENTS.ROOM_JOIN);
    rerender({ onForceMute: latest });

    const hostMute = socket.on.mock.calls.find(([event]) => event === SOCKET_EVENTS.ROOM_HOST_MUTE);
    const handler = hostMute?.[1] as (data: unknown) => void;
    act(() => handler({ meetingId: MEETING.id, targetUserId: null, byUserId: 'someone-else' }));

    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });

  it('joins the room again when the socket reconnects, and rebuilds the mesh', async () => {
    const { result } = renderHook(
      () => useMeetingRoom({ meeting: MEETING, localStream: null, onForceMute: () => {} }),
      { wrapper },
    );
    await settle();
    await settle();

    const handler = (event: string) =>
      socket.on.mock.calls.find(([name]) => name === event)?.[1] as (data?: unknown) => void;
    const joins = () => socket.emitted.filter((event) => event === SOCKET_EVENTS.ROOM_JOIN);
    const roster = (selfSocketId: string) => ({
      meetingId: MEETING.id,
      selfSocketId,
      participants: [
        {
          socketId: selfSocketId,
          userId: MEETING.hostId,
          name: 'Ada Lovelace',
          avatarUrl: null,
          isHost: true,
          media: { audio: true, video: true, screen: false },
          joinedAt: new Date().toISOString(),
        },
      ],
      recording: false,
    });

    // A connect before the first roster is the original join going out.
    act(() => handler('connect')());
    expect(joins()).toHaveLength(1);

    act(() => handler(SOCKET_EVENTS.ROOM_PARTICIPANTS)(roster('first-socket')));
    const firstTransport = result.current.transport;
    expect(result.current.phase).toBe('live');

    // The server restarted: a new socket, in no rooms, until we say so.
    act(() => handler('connect')());
    expect(joins()).toHaveLength(2);

    act(() => handler(SOCKET_EVENTS.ROOM_PARTICIPANTS)(roster('second-socket')));
    expect(result.current.phase).toBe('live');
    expect(result.current.self?.socketId).toBe('second-socket');
    expect(result.current.transport).not.toBe(firstTransport);
  });
});
