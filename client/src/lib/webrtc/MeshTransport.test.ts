import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SOCKET_EVENTS, type Participant } from '@intellmeet/shared';
import { MeshTransport } from './MeshTransport';

/**
 * A fake `RTCPeerConnection`.
 *
 * jsdom has no WebRTC at all, and a real one would need two browsers. What
 * matters here is the negotiation *logic* - who backs down in a collision,
 * what is sent and when - which is exactly what a fake can exercise
 * deterministically.
 */
class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  readonly senders: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> }[] =
    [];
  readonly addedTracks: MediaStreamTrack[] = [];
  readonly addedCandidates: RTCIceCandidateInit[] = [];
  restartIce = vi.fn();
  close = vi.fn();

  constructor(public readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  getSenders() {
    return this.senders;
  }

  addTrack(track: MediaStreamTrack) {
    this.addedTracks.push(track);

    const sender: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> } = {
      track,
      replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => {
        sender.track = next;
      }),
    };

    this.senders.push(sender);
    return sender;
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit) {
    // Mirrors the browser: with no argument it produces whatever the current
    // signalling state calls for.
    const type = description?.type ?? (this.remoteDescription ? 'answer' : 'offer');
    this.localDescription = { type, sdp: `sdp-${type}` } as RTCSessionDescriptionInit;
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.addedCandidates.push(candidate);
  }
}

/** A socket that records emissions and can deliver inbound events. */
function fakeSocket() {
  const handlers = new Map<string, ((data: unknown) => void)[]>();
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];

  return {
    emitted,
    on(event: string, handler: (data: unknown) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    off(event: string, handler: (data: unknown) => void) {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((entry) => entry !== handler),
      );
    },
    emit(event: string, payload: Record<string, unknown>) {
      emitted.push({ event, payload });
    },
    /** Simulates a signal arriving from the server. */
    deliver(event: string, data: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(data);
    },
  };
}

const MEETING_ID = '507f1f77bcf86cd799439011';

function participant(socketId: string, overrides: Partial<Participant> = {}): Participant {
  return {
    socketId,
    userId: '507f1f77bcf86cd799439012',
    name: 'Ada Lovelace',
    avatarUrl: null,
    isHost: false,
    media: { audio: true, video: true, screen: false },
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function build(selfSocketId: string) {
  const socket = fakeSocket();
  const onPeersChanged = vi.fn();
  const onError = vi.fn();

  const transport = new MeshTransport(
    socket as never,
    MEETING_ID,
    selfSocketId,
    [{ urls: 'stun:stun.l.google.com:19302' }],
    { onPeersChanged, onError },
  );

  return { socket, transport, onPeersChanged, onError };
}

/** Lets queued promise callbacks inside the transport settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MeshTransport', () => {
  it('opens one peer connection per participant, with the server ICE config', () => {
    const { transport } = build('aaa');

    transport.addPeer(participant('bbb'));
    transport.addPeer(participant('ccc'));

    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(FakePeerConnection.instances[0]?.config.iceServers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
    ]);
  });

  it('never opens a connection to itself', () => {
    const { transport } = build('aaa');

    transport.addPeer(participant('aaa'));

    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it('publishes local tracks to a peer that joins later', () => {
    const { transport } = build('aaa');
    const track = { kind: 'video', id: 'v1' } as MediaStreamTrack;
    const stream = { getTracks: () => [track] } as unknown as MediaStream;

    transport.start(stream);
    transport.addPeer(participant('bbb'));

    expect(FakePeerConnection.instances[0]?.addedTracks).toEqual([track]);
  });

  it('sends an offer when the browser asks to negotiate', async () => {
    const { socket, transport } = build('aaa');
    transport.addPeer(participant('bbb'));

    FakePeerConnection.instances[0]?.onnegotiationneeded?.();
    await flush();

    const offer = socket.emitted.find((entry) => entry.event === SOCKET_EVENTS.RTC_OFFER);
    expect(offer?.payload).toMatchObject({ target: 'bbb', meetingId: MEETING_ID });
  });

  it('answers an incoming offer', async () => {
    const { socket, transport } = build('aaa');
    transport.addPeer(participant('bbb'));

    socket.deliver(SOCKET_EVENTS.RTC_OFFER, {
      from: 'bbb',
      fromUserId: '507f1f77bcf86cd799439012',
      meetingId: MEETING_ID,
      payload: { description: { type: 'offer', sdp: 'remote' } },
    });
    await flush();

    const answer = socket.emitted.find((entry) => entry.event === SOCKET_EVENTS.RTC_ANSWER);
    expect(answer?.payload.target).toBe('bbb');
    expect(FakePeerConnection.instances[0]?.remoteDescription).toEqual({
      type: 'offer',
      sdp: 'remote',
    });
  });

  it('backs down from a colliding offer when it is the polite peer', async () => {
    // 'aaa' < 'bbb', so this transport is polite towards bbb.
    const { socket, transport } = build('aaa');
    transport.addPeer(participant('bbb'));

    // We start an offer...
    FakePeerConnection.instances[0]?.onnegotiationneeded?.();
    await flush();

    // ...and theirs arrives while ours is outstanding. Glare.
    socket.deliver(SOCKET_EVENTS.RTC_OFFER, {
      from: 'bbb',
      fromUserId: '507f1f77bcf86cd799439012',
      meetingId: MEETING_ID,
      payload: { description: { type: 'offer', sdp: 'theirs' } },
    });
    await flush();

    // The polite peer accepts theirs and answers, rather than deadlocking.
    expect(FakePeerConnection.instances[0]?.remoteDescription).toEqual({
      type: 'offer',
      sdp: 'theirs',
    });
    expect(socket.emitted.some((entry) => entry.event === SOCKET_EVENTS.RTC_ANSWER)).toBe(true);
  });

  it('ignores a colliding offer when it is the impolite peer', async () => {
    // 'zzz' > 'bbb', so this transport is impolite towards bbb.
    const { socket, transport } = build('zzz');
    transport.addPeer(participant('bbb'));

    FakePeerConnection.instances[0]?.onnegotiationneeded?.();
    await flush();

    socket.deliver(SOCKET_EVENTS.RTC_OFFER, {
      from: 'bbb',
      fromUserId: '507f1f77bcf86cd799439012',
      meetingId: MEETING_ID,
      payload: { description: { type: 'offer', sdp: 'theirs' } },
    });
    await flush();

    // Their offer is discarded; ours stands. Exactly one side gives way, which
    // is what stops both ends from rolling back and starting over forever.
    expect(FakePeerConnection.instances[0]?.remoteDescription).toBeNull();
    expect(socket.emitted.some((entry) => entry.event === SOCKET_EVENTS.RTC_ANSWER)).toBe(false);
  });

  it('relays ICE candidates in both directions', async () => {
    const { socket, transport } = build('aaa');
    transport.addPeer(participant('bbb'));

    const pc = FakePeerConnection.instances[0];
    pc?.onicecandidate?.({
      candidate: { toJSON: () => ({ candidate: 'a=candidate:1' }) } as unknown as RTCIceCandidate,
    });

    expect(
      socket.emitted.find((entry) => entry.event === SOCKET_EVENTS.RTC_ICE_CANDIDATE)?.payload,
    ).toMatchObject({ target: 'bbb' });

    socket.deliver(SOCKET_EVENTS.RTC_ICE_CANDIDATE, {
      from: 'bbb',
      fromUserId: '507f1f77bcf86cd799439012',
      meetingId: MEETING_ID,
      payload: { candidate: { candidate: 'a=candidate:2' } },
    });
    await flush();

    expect(pc?.addedCandidates).toEqual([{ candidate: 'a=candidate:2' }]);
  });

  it('drops a signal for a peer it has not been told about', async () => {
    const { socket, transport, onError } = build('aaa');
    transport.addPeer(participant('bbb'));

    socket.deliver(SOCKET_EVENTS.RTC_OFFER, {
      from: 'unknown-peer',
      fromUserId: '507f1f77bcf86cd799439012',
      meetingId: MEETING_ID,
      payload: { description: { type: 'offer', sdp: 'x' } },
    });
    await flush();

    expect(FakePeerConnection.instances[0]?.remoteDescription).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('restarts ICE instead of dropping the peer when the connection fails', () => {
    const { transport } = build('aaa');
    transport.addPeer(participant('bbb'));

    const pc = FakePeerConnection.instances[0];
    if (!pc) throw new Error('no peer connection');

    pc.iceConnectionState = 'failed';
    pc.oniceconnectionstatechange?.();

    // A network change should recover in place - the tile must not vanish.
    expect(pc.restartIce).toHaveBeenCalledOnce();
  });

  it('swaps the outgoing video track without renegotiating', async () => {
    const { socket, transport } = build('aaa');
    const camera = { kind: 'video', id: 'cam' } as MediaStreamTrack;
    transport.start({ getTracks: () => [camera] } as unknown as MediaStream);
    transport.addPeer(participant('bbb'));

    const before = socket.emitted.length;
    const screen = { kind: 'video', id: 'screen' } as MediaStreamTrack;
    await transport.replaceVideoTrack(screen);

    expect(FakePeerConnection.instances[0]?.senders[0]?.replaceTrack).toHaveBeenCalledWith(screen);
    // No new offer: that is the whole point of replaceTrack.
    expect(socket.emitted.length).toBe(before);
  });

  it('reports peers to the UI as they arrive, change and leave', () => {
    const { transport, onPeersChanged } = build('aaa');

    transport.addPeer(participant('bbb', { name: 'Grace Hopper' }));
    expect(onPeersChanged.mock.lastCall?.[0]).toHaveLength(1);

    transport.updatePeerMedia('bbb', { audio: false, video: true, screen: false });
    expect(onPeersChanged.mock.lastCall?.[0][0].media.audio).toBe(false);

    transport.removePeer('bbb');
    expect(onPeersChanged.mock.lastCall?.[0]).toHaveLength(0);
  });

  it('closes every connection and stops listening when the room is left', () => {
    const { socket, transport } = build('aaa');
    transport.addPeer(participant('bbb'));

    transport.close();

    expect(FakePeerConnection.instances[0]?.close).toHaveBeenCalledOnce();

    // A signal arriving after close must not resurrect anything.
    socket.deliver(SOCKET_EVENTS.RTC_OFFER, {
      from: 'bbb',
      fromUserId: '507f1f77bcf86cd799439012',
      meetingId: MEETING_ID,
      payload: { description: { type: 'offer', sdp: 'late' } },
    });

    expect(FakePeerConnection.instances[0]?.remoteDescription).toBeNull();
  });
});
