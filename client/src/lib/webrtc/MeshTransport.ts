import type { Socket } from 'socket.io-client';
import { SOCKET_EVENTS, type IceServer, type Participant } from '@intellmeet/shared';
import type { MediaTransport, MeshCallbacks, RemotePeer } from './types';

/** What travels inside the `payload` of an rtc:* event. */
interface SignalPayload {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

/**
 * How long a peer may sit in `new` - ICE not even started - before the
 * watchdog steps in. A healthy connection on the same network leaves `new`
 * within a second; one still there after this has stalled rather than being
 * slow, and waiting longer only means a longer blank tile.
 */
export const CONNECT_WATCHDOG_MS = 5000;

/** Watchdog interventions per peer before telling the user it is not working. */
const MAX_WATCHDOG_ATTEMPTS = 3;

interface DeliveredSignal {
  from: string;
  fromUserId: string;
  meetingId: string;
  payload: unknown;
}

/**
 * Per-peer state for the perfect-negotiation dance.
 *
 * These three flags are not incidental bookkeeping - they *are* the algorithm.
 * Without them, two browsers that both decide to renegotiate at the same
 * moment (a "glare" collision, which screen sharing makes routine) each
 * receive an offer while already having one outstanding, and the connection
 * wedges in `have-local-offer` until somebody reloads.
 */
interface PeerEntry {
  pc: RTCPeerConnection;
  participant: Participant;
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
  /** True while our own offer is being created and sent. */
  makingOffer: boolean;
  /** True once we have decided to discard an incoming colliding offer. */
  ignoreOffer: boolean;
  /** True between setRemoteDescription(answer) starting and finishing. */
  settingRemoteAnswerPending: boolean;
  /**
   * The impolite peer wins a collision; the polite one backs down.
   * Derived from comparing socket ids, so the two ends always disagree - which
   * is exactly what makes it a tie-break rather than a stand-off.
   */
  polite: boolean;
  /**
   * True for a peer that joined after us, until its first offer arrives.
   *
   * The newcomer offers and everyone already in the room answers, so a join
   * never starts with both sides offering at once. That collision is
   * survivable in theory, but in practice it routes every join through a
   * rollback - and Chrome intermittently never gathers ICE candidates for the
   * answer that follows one, leaving the call stuck with ICE not even started.
   */
  awaitingOffer: boolean;
  watchdog: ReturnType<typeof setTimeout> | null;
  watchdogAttempts: number;
}

export interface AddPeerOptions {
  /**
   * Whether we open the negotiation. True when the peer was already in the
   * room when we arrived (we are the newcomer); false when the room tells us
   * somebody new has joined, in which case they will send the offer.
   */
  initiator: boolean;
}

/**
 * A full-mesh WebRTC transport: one `RTCPeerConnection` per remote
 * participant, media peer to peer, and the Socket.io server used only to
 * introduce browsers to each other.
 *
 * The server never sees a frame of video. It relays SDP and ICE verbatim
 * without parsing them (see `server/src/sockets/socket.handlers.ts`), which is
 * what keeps bandwidth cost at zero and makes the free hosting tier viable.
 *
 * The cost is that every participant uploads their stream once per *other*
 * participant, so upstream bandwidth grows linearly and the practical ceiling
 * is around six people. `docs/architecture.md` documents the SFU upgrade path.
 */
export class MeshTransport implements MediaTransport {
  private readonly peers = new Map<string, PeerEntry>();
  private localStream: MediaStream | null = null;
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly meetingId: string,
    private readonly selfSocketId: string,
    private readonly iceServers: IceServer[],
    private readonly callbacks: MeshCallbacks,
  ) {
    this.bindSocket();
  }

  // --- Public surface ------------------------------------------------------

  start(localStream: MediaStream): void {
    this.localStream = localStream;

    // Anyone already connected needs the new tracks attached and renegotiated.
    for (const entry of this.peers.values()) this.publishTo(entry);
  }

  /**
   * Adds a participant the room told us about and opens a connection to them.
   *
   * Only the newcomer offers (`initiator`); the people already in the room
   * wait for that offer and attach their tracks to it. Perfect negotiation is
   * still there for everything after the first exchange - and for the rare
   * join where both sides do end up offering - but a routine join no longer
   * collides by construction.
   */
  addPeer(participant: Participant, { initiator }: AddPeerOptions): void {
    if (this.closed) return;
    if (participant.socketId === this.selfSocketId) return;
    if (this.peers.has(participant.socketId)) {
      // A re-announce (reconnect) - keep the connection, refresh the metadata.
      const existing = this.peers.get(participant.socketId);
      if (existing) existing.participant = participant;
      this.emitPeers();
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[] });

    const entry: PeerEntry = {
      pc,
      participant,
      stream: null,
      connectionState: 'new',
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswerPending: false,
      // Deterministic and opposite on the two ends: whoever has the
      // lexicographically smaller socket id is the polite one.
      polite: this.selfSocketId < participant.socketId,
      awaitingOffer: !initiator,
      watchdog: null,
      watchdogAttempts: 0,
    };

    this.peers.set(participant.socketId, entry);
    this.bindPeer(entry);
    this.publishTo(entry);
    this.armWatchdog(entry);
    this.emitPeers();
  }

  removePeer(socketId: string): void {
    const entry = this.peers.get(socketId);
    if (!entry) return;

    this.disarmWatchdog(entry);
    entry.pc.close();
    this.peers.delete(socketId);
    this.emitPeers();
  }

  /** Updates the media flags a peer publishes about itself (mic/camera icons). */
  updatePeerMedia(socketId: string, media: Participant['media']): void {
    const entry = this.peers.get(socketId);
    if (!entry) return;

    entry.participant = { ...entry.participant, media };
    this.emitPeers();
  }

  /**
   * Swaps the outgoing video track on every connection.
   *
   * `replaceTrack` on the sender rather than removing and re-adding it: the
   * SDP is unchanged, so there is no renegotiation, no glare and no black
   * frame while the answer comes back. This is what makes starting a screen
   * share instant rather than a visible stutter for everyone.
   */
  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrackOfKind('video', track);
  }

  async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrackOfKind('audio', track);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    this.unbindSocket();

    for (const entry of this.peers.values()) {
      this.disarmWatchdog(entry);
      entry.pc.close();
    }
    this.peers.clear();
    this.emitPeers();
  }

  // --- Peer plumbing -------------------------------------------------------

  private async replaceTrackOfKind(
    kind: 'video' | 'audio',
    track: MediaStreamTrack | null,
  ): Promise<void> {
    await Promise.all(
      [...this.peers.values()].map(async (entry) => {
        const sender = entry.pc.getSenders().find((candidate) => candidate.track?.kind === kind);
        // No existing sender of this kind means nothing was ever published -
        // adding one now would need a renegotiation we deliberately avoid here.
        if (!sender) return;

        try {
          await sender.replaceTrack(track);
        } catch {
          this.callbacks.onError(`Could not switch ${kind} for ${entry.participant.name}.`);
        }
      }),
    );
  }

  private publishTo(entry: PeerEntry): void {
    // Tracks added now would fire `negotiationneeded` and make us offer too.
    // They are attached to the peer's offer when it arrives instead.
    if (entry.awaitingOffer) return;

    if (!this.localStream) {
      // Somebody who joined with no camera or microphone still has to open
      // the negotiation, or nobody would: the people already here are waiting
      // for an offer. Receive-only transceivers give the offer something to
      // say.
      if (entry.pc.getTransceivers().length === 0) {
        entry.pc.addTransceiver('audio', { direction: 'recvonly' });
        entry.pc.addTransceiver('video', { direction: 'recvonly' });
      }
      return;
    }

    for (const track of this.localStream.getTracks()) {
      const existing = entry.pc.getSenders().find((sender) => sender.track?.kind === track.kind);

      if (existing) {
        void existing.replaceTrack(track);
      } else {
        entry.pc.addTrack(track, this.localStream);
      }
    }
  }

  private bindPeer(entry: PeerEntry): void {
    const { pc } = entry;
    const target = entry.participant.socketId;

    pc.onnegotiationneeded = () => {
      void (async () => {
        try {
          entry.makingOffer = true;
          // No argument: the browser picks offer or answer correctly for the
          // current signalling state, which is the whole point of the modern
          // parameterless form.
          await pc.setLocalDescription();
          this.send(SOCKET_EVENTS.RTC_OFFER, target, {
            description: pc.localDescription ?? undefined,
          });
        } catch {
          this.callbacks.onError(`Could not negotiate with ${entry.participant.name}.`);
        } finally {
          entry.makingOffer = false;
        }
      })();
    };

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.send(SOCKET_EVENTS.RTC_ICE_CANDIDATE, target, { candidate: candidate.toJSON() });
    };

    pc.ontrack = ({ track, streams }) => {
      // Take the stream the browser groups the tracks into, so audio and video
      // from one peer stay on one MediaStream and a single <video> plays both.
      const [stream] = streams;
      entry.stream = stream ?? new MediaStream([track]);
      this.emitPeers();
    };

    pc.onconnectionstatechange = () => {
      entry.connectionState = pc.connectionState;
      if (pc.connectionState === 'connected') {
        this.disarmWatchdog(entry);
        entry.watchdogAttempts = 0;
      }
      this.emitPeers();
    };

    pc.oniceconnectionstatechange = () => {
      // A failed ICE connection is usually a network change - switching from
      // WiFi to mobile data, or a VPN coming up. An ICE restart re-gathers
      // candidates on the existing connection instead of rebuilding it, so the
      // call recovers without the peer's tile disappearing.
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
  }

  /**
   * Recovers a connection whose ICE never started.
   *
   * The ICE restart above only fires on `failed`, and a connection that never
   * gathered a candidate never gets that far: it sits in `new` indefinitely,
   * which the user sees as a tile that never fills in. After
   * `CONNECT_WATCHDOG_MS` in that state:
   *
   * - if we are still waiting for the newcomer's offer, stop waiting and offer
   *   ourselves - the offer was lost, or never coming;
   * - otherwise the impolite side restarts ICE, which renegotiates with fresh
   *   credentials and forces both ends to gather again. Only the impolite side,
   *   so the two ends do not both restart and collide.
   *
   * A connection that is merely slow (`connecting`, checks in progress) is left
   * alone: ICE's own timers will either succeed or reach `failed`.
   */
  private armWatchdog(entry: PeerEntry): void {
    this.disarmWatchdog(entry);

    entry.watchdog = setTimeout(() => {
      entry.watchdog = null;
      if (this.closed || entry.pc.connectionState !== 'new') return;

      entry.watchdogAttempts += 1;
      if (entry.watchdogAttempts > MAX_WATCHDOG_ATTEMPTS) {
        this.callbacks.onError(`Could not connect to ${entry.participant.name}.`);
        return;
      }

      if (entry.awaitingOffer) {
        entry.awaitingOffer = false;
        this.publishTo(entry);
      } else if (!entry.polite) {
        entry.pc.restartIce();
      }

      this.armWatchdog(entry);
    }, CONNECT_WATCHDOG_MS);
  }

  private disarmWatchdog(entry: PeerEntry): void {
    if (entry.watchdog) clearTimeout(entry.watchdog);
    entry.watchdog = null;
  }

  // --- Signalling ----------------------------------------------------------

  private readonly onOffer = (data: unknown) => this.handleDescription(data);
  private readonly onAnswer = (data: unknown) => this.handleDescription(data);
  private readonly onCandidate = (data: unknown) => this.handleCandidate(data);

  private bindSocket(): void {
    this.socket.on(SOCKET_EVENTS.RTC_OFFER, this.onOffer);
    this.socket.on(SOCKET_EVENTS.RTC_ANSWER, this.onAnswer);
    this.socket.on(SOCKET_EVENTS.RTC_ICE_CANDIDATE, this.onCandidate);
  }

  private unbindSocket(): void {
    this.socket.off(SOCKET_EVENTS.RTC_OFFER, this.onOffer);
    this.socket.off(SOCKET_EVENTS.RTC_ANSWER, this.onAnswer);
    this.socket.off(SOCKET_EVENTS.RTC_ICE_CANDIDATE, this.onCandidate);
  }

  private send(event: string, target: string, payload: SignalPayload): void {
    this.socket.emit(event, { target, meetingId: this.meetingId, payload });
  }

  private entryFor(data: unknown): { entry: PeerEntry; payload: SignalPayload } | null {
    const signal = data as DeliveredSignal | null;
    if (!signal?.from || signal.meetingId !== this.meetingId) return null;

    const entry = this.peers.get(signal.from);
    // A signal from somebody we have not been told about yet. Dropping it is
    // safe: the room announcement is what creates the connection, and the
    // sender will renegotiate once it arrives.
    if (!entry) return null;

    return { entry, payload: (signal.payload ?? {}) as SignalPayload };
  }

  /**
   * The perfect-negotiation core, straight from the WebRTC specification's
   * recommended implementation.
   *
   * The subtle part is `readyForOffer`. An offer arriving while we have one in
   * flight is a collision; the impolite peer ignores it and pushes on with its
   * own, the polite peer rolls back and accepts. Both ends therefore converge
   * on one negotiation instead of deadlocking, and neither needs to know who
   * started.
   */
  private handleDescription(data: unknown): void {
    const resolved = this.entryFor(data);
    if (!resolved) return;

    const { entry, payload } = resolved;
    const description = payload.description;
    if (!description) return;

    void (async () => {
      try {
        const readyForOffer =
          !entry.makingOffer &&
          (entry.pc.signalingState === 'stable' || entry.settingRemoteAnswerPending);

        const offerCollision = description.type === 'offer' && !readyForOffer;

        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        entry.settingRemoteAnswerPending = description.type === 'answer';
        await entry.pc.setRemoteDescription(description);
        entry.settingRemoteAnswerPending = false;

        if (description.type === 'offer' && entry.awaitingOffer) {
          // The newcomer's offer is here. Tracks added now attach to the
          // transceivers it created, so the answer carries our media and no
          // second round of negotiation is needed.
          entry.awaitingOffer = false;
          this.publishTo(entry);
        }

        if (description.type === 'offer') {
          await entry.pc.setLocalDescription();
          this.send(SOCKET_EVENTS.RTC_ANSWER, entry.participant.socketId, {
            description: entry.pc.localDescription ?? undefined,
          });
        }
      } catch {
        entry.settingRemoteAnswerPending = false;
        this.callbacks.onError(`Connection to ${entry.participant.name} failed to negotiate.`);
      }
    })();
  }

  private handleCandidate(data: unknown): void {
    const resolved = this.entryFor(data);
    if (!resolved) return;

    const { entry, payload } = resolved;
    if (!payload.candidate) return;

    void entry.pc.addIceCandidate(payload.candidate).catch(() => {
      // Candidates that arrive for an offer we chose to ignore are expected
      // and harmless. Anything else is a genuine failure, but ICE has its own
      // recovery (see the restart above), so it is not worth a toast.
    });
  }

  // --- Notification --------------------------------------------------------

  private emitPeers(): void {
    const peers: RemotePeer[] = [...this.peers.values()].map((entry) => ({
      ...entry.participant,
      stream: entry.stream,
      connectionState: entry.connectionState,
    }));

    this.callbacks.onPeersChanged(peers);
  }
}
