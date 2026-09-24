import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SOCKET_EVENTS } from '@intellmeet/shared';
import { useSocketStore } from '@/stores/socketStore';
import { useRecordingIndicator } from './useRecordingIndicator';

const MEETING_ID = '507f1f77bcf86cd799439011';

/** A socket whose listeners the test can fire by hand. */
function fakeSocket() {
  const handlers = new Map<string, (data: unknown) => void>();
  return {
    on: vi.fn((event: string, handler: (data: unknown) => void) => handlers.set(event, handler)),
    off: vi.fn(),
    emit: vi.fn(),
    fire: (event: string, data: unknown) => act(() => handlers.get(event)?.(data)),
  };
}

let socket: ReturnType<typeof fakeSocket>;

beforeEach(() => {
  socket = fakeSocket();
  useSocketStore.setState({ socket: socket as never });
});

afterEach(() => {
  act(() => useSocketStore.setState({ socket: null }));
});

describe('useRecordingIndicator', () => {
  it('shows a recording already in progress to somebody who has just joined', () => {
    const { result } = renderHook(() => useRecordingIndicator(MEETING_ID));

    socket.fire(SOCKET_EVENTS.ROOM_PARTICIPANTS, { meetingId: MEETING_ID, recording: true });

    expect(result.current.recording).toBe(true);
  });

  it('follows the host starting and stopping', () => {
    const { result } = renderHook(() => useRecordingIndicator(MEETING_ID));

    socket.fire(SOCKET_EVENTS.RECORDING_STATE, { meetingId: MEETING_ID, recording: true });
    expect(result.current.recording).toBe(true);

    socket.fire(SOCKET_EVENTS.RECORDING_STATE, { meetingId: MEETING_ID, recording: false });
    expect(result.current.recording).toBe(false);
  });

  it('ignores another meeting', () => {
    const { result } = renderHook(() => useRecordingIndicator(MEETING_ID));

    socket.fire(SOCKET_EVENTS.RECORDING_STATE, { meetingId: 'someone-else', recording: true });

    expect(result.current.recording).toBe(false);
  });

  it('announces a change to the room rather than setting it locally', () => {
    const { result } = renderHook(() => useRecordingIndicator(MEETING_ID));

    act(() => result.current.announce(true));

    // The badge only changes when the server's broadcast comes back, so the
    // host sees exactly what everyone else sees.
    expect(socket.emit).toHaveBeenCalledWith(SOCKET_EVENTS.RECORDING_STATE, {
      meetingId: MEETING_ID,
      recording: true,
    });
    expect(result.current.recording).toBe(false);
  });
});
