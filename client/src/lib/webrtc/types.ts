import type { MediaState, Participant } from '@intellmeet/shared';

/**
 * One remote person in the call, as the UI needs to render them.
 *
 * The socket knows who is in the room; the peer connection knows what their
 * media is doing. This is the two joined together, keyed by socket id rather
 * than user id because one person may legitimately be in twice (a phone and a
 * laptop), and each tab is its own peer connection.
 */
export interface RemotePeer extends Participant {
  /** Null until the first remote track arrives. */
  stream: MediaStream | null;
  connectionState: RTCPeerConnectionState;
}

/**
 * The seam that lets the mesh be swapped for an SFU.
 *
 * Everything above this interface - the grid, the controls, the side panel -
 * talks only in terms of "peers with streams" and "replace my outgoing track".
 * None of it knows that today there is one `RTCPeerConnection` per participant.
 * When the mesh runs out of headroom (see `docs/architecture.md`), a
 * `LiveKitTransport` implementing this same interface replaces `MeshTransport`
 * and the UI is untouched.
 */
export interface MediaTransport {
  /** Starts publishing `localStream` and connecting to everyone already here. */
  start(localStream: MediaStream): void;

  /**
   * Swaps the outgoing video track on every peer connection without
   * renegotiating - how screen sharing starts and stops.
   */
  replaceVideoTrack(track: MediaStreamTrack | null): Promise<void>;

  /** Same for audio, used when the microphone device is changed mid-call. */
  replaceAudioTrack(track: MediaStreamTrack | null): Promise<void>;

  /** Tears down every peer connection. Safe to call twice. */
  close(): void;
}

export interface MeshCallbacks {
  /** Fires whenever the peer list or any peer's stream/state changes. */
  onPeersChanged: (peers: RemotePeer[]) => void;
  /** A peer-level failure worth telling the user about. */
  onError: (message: string) => void;
}

/** The media flags a participant publishes about themselves. */
export type { MediaState };
