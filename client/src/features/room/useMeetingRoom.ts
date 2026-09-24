import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  SOCKET_EVENTS,
  type ChatMessage,
  type Meeting,
  type MediaState,
  type Participant,
  type RoomParticipants,
} from '@intellmeet/shared';
import { MeshTransport } from '@/lib/webrtc/MeshTransport';
import type { RemotePeer } from '@/lib/webrtc/types';
import { getMessageHistory, messageKeys } from '@/features/meetings/meetings.api';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import { fetchIceServers, iceKeys } from './ice.api';

export type RoomPhase = 'connecting' | 'live' | 'ended' | 'error';

export interface MeetingRoom {
  phase: RoomPhase;
  error: string | null;
  peers: RemotePeer[];
  self: Participant | null;
  messages: ChatMessage[];
  typingNames: string[];
  /** False when the server has no TURN configured, so restrictive networks fail. */
  hasTurn: boolean;
  transport: MeshTransport | null;
  sendChat: (text: string) => void;
  notifyTyping: () => void;
  publishMediaState: (state: MediaState) => void;
  muteEveryone: () => void;
  muteParticipant: (userId: string) => void;
  endForEveryone: () => void;
  leave: () => void;
}

interface Options {
  meeting: Meeting;
  localStream: MediaStream | null;
  /** Called when the host mutes us, so the local track can actually stop. */
  onForceMute: () => void;
}

const TYPING_TIMEOUT_MS = 4000;

/**
 * Binds the socket room, the mesh transport and the chat into one hook.
 *
 * Deliberately one hook rather than several: joining a room, opening peer
 * connections and loading chat history all hang off the same `room:join`, and
 * splitting them would mean three components racing to be first to join.
 */
export function useMeetingRoom({ meeting, localStream, onForceMute }: Options): MeetingRoom {
  const socket = useSocketStore((state) => state.socket);
  const me = useAuthStore((state) => state.user);

  const [phase, setPhase] = useState<RoomPhase>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [self, setSelf] = useState<Participant | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});

  const transportRef = useRef<MeshTransport | null>(null);
  const localStreamRef = useRef(localStream);
  localStreamRef.current = localStream;

  // Read through a ref, not listed as an effect dependency. The caller builds
  // this callback from its media object, which is new on every render of the
  // page above - and a dependency here would leave and rejoin the room, tearing
  // down every peer connection, each time somebody toggled their microphone.
  const onForceMuteRef = useRef(onForceMute);
  onForceMuteRef.current = onForceMute;

  // ICE servers come from the API rather than the bundle: a TURN credential in
  // public JavaScript is a relay somebody else pays for.
  const ice = useQuery({ queryKey: iceKeys.servers, queryFn: fetchIceServers, staleTime: 300_000 });

  const meetingId = meeting.id;

  // What was said before we arrived. Merged rather than replaced, because a
  // live message can land while the history request is still in flight.
  const history = useQuery({
    queryKey: messageKeys.history(meetingId),
    queryFn: () => getMessageHistory(meetingId),
    staleTime: Infinity,
  });

  const historyMessages = history.data?.messages;

  useEffect(() => {
    if (!historyMessages) return;

    setMessages((live) => {
      const seen = new Set(historyMessages.map((message) => message.id));
      return [...historyMessages, ...live.filter((message) => !seen.has(message.id))];
    });
  }, [historyMessages]);

  // --- Join, wire up, and tear down ---------------------------------------

  useEffect(() => {
    if (!socket || !ice.data) return;

    let active = true;
    // Whether a roster has arrived, i.e. the server has us in the room.
    let joined = false;

    const onParticipants = (raw: unknown) => {
      const data = raw as RoomParticipants;
      if (!active || data.meetingId !== meetingId) return;

      // The roster arrives in response to our join, and carries our own
      // socket id - which the mesh needs both to exclude itself and to decide
      // politeness for every peer. After a reconnect it arrives again, for a
      // new socket id: every existing connection was keyed to the old one,
      // so the mesh is rebuilt rather than patched.
      transportRef.current?.close();
      joined = true;

      const transport = new MeshTransport(
        socket,
        meetingId,
        data.selfSocketId,
        ice.data.iceServers,
        {
          onPeersChanged: (next) => {
            if (active) setPeers(next);
          },
          onError: (message) => toast.error(message),
        },
      );

      transportRef.current = transport;
      if (localStreamRef.current) transport.start(localStreamRef.current);

      // We are the newcomer, so we open the negotiation with everyone already
      // here. They answer; see `awaitingOffer` in MeshTransport for why only
      // one side offers.
      for (const participant of data.participants) {
        if (participant.socketId === data.selfSocketId) {
          setSelf(participant);
          continue;
        }
        transport.addPeer(participant, { initiator: true });
      }

      setPhase('live');
    };

    const onUserJoined = (raw: unknown) => {
      const data = raw as { meetingId: string; participant: Participant };
      if (data.meetingId !== meetingId) return;
      // They arrived after us, so they send the offer and we answer it.
      transportRef.current?.addPeer(data.participant, { initiator: false });
    };

    const onUserLeft = (raw: unknown) => {
      const data = raw as { meetingId: string; socketId: string };
      if (data.meetingId !== meetingId) return;
      transportRef.current?.removePeer(data.socketId);
    };

    const onMediaToggle = (raw: unknown) => {
      const data = raw as { meetingId: string; socketId: string; state: MediaState };
      if (data.meetingId !== meetingId) return;
      transportRef.current?.updatePeerMedia(data.socketId, data.state);
    };

    const onChatMessage = (raw: unknown) => {
      const message = raw as ChatMessage;
      if (message.meetingId !== meetingId) return;
      // Guard against a duplicate if the socket reconnects and replays.
      setMessages((current) =>
        current.some((existing) => existing.id === message.id) ? current : [...current, message],
      );
    };

    const onTyping = (raw: unknown) => {
      const data = raw as { meetingId: string; userId: string; name: string };
      if (data.meetingId !== meetingId || data.userId === me?.id) return;
      setTyping((current) => ({ ...current, [data.userId]: { name: data.name, at: Date.now() } }));
    };

    const onStopTyping = (raw: unknown) => {
      const data = raw as { meetingId: string; userId: string };
      setTyping((current) => {
        const next = { ...current };
        delete next[data.userId];
        return next;
      });
    };

    const onHostMute = (raw: unknown) => {
      const data = raw as { meetingId: string; targetUserId: string | null; byUserId: string };
      if (data.meetingId !== meetingId) return;
      // Addressed to everyone, or to us specifically - but never to the person
      // who pressed the button.
      if (data.byUserId === me?.id) return;
      if (data.targetUserId && data.targetUserId !== me?.id) return;

      onForceMuteRef.current();
      toast.info('The host muted your microphone.');
    };

    const onRoomEnd = (raw: unknown) => {
      const data = raw as { meetingId: string };
      if (data.meetingId !== meetingId) return;
      setPhase('ended');
      transportRef.current?.close();
    };

    const onSocketError = (raw: unknown) => {
      const data = raw as { event: string; code: string; message: string };

      // A failure of the join itself is fatal for this screen; anything else
      // (a rejected chat message, a throttle) is a toast.
      if (data.event === SOCKET_EVENTS.ROOM_JOIN) {
        setError(data.message);
        setPhase('error');
        return;
      }

      toast.error(data.message);
    };

    // Socket.io reconnects by itself after a dropped connection or a server
    // restart, but as a new socket that is in no rooms. Without joining again
    // the server would think we had left - no chat, no signalling, and the
    // idle sweep would eventually end the meeting under a call still running
    // peer to peer. Before the first roster there is nothing to redo: the
    // original join is still queued and goes out on connect.
    const onReconnect = () => {
      if (!active || !joined) return;
      socket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    };

    socket.on('connect', onReconnect);
    socket.on(SOCKET_EVENTS.ROOM_PARTICIPANTS, onParticipants);
    socket.on(SOCKET_EVENTS.ROOM_USER_JOINED, onUserJoined);
    socket.on(SOCKET_EVENTS.ROOM_USER_LEFT, onUserLeft);
    socket.on(SOCKET_EVENTS.MEDIA_TOGGLE, onMediaToggle);
    socket.on(SOCKET_EVENTS.CHAT_MESSAGE, onChatMessage);
    socket.on(SOCKET_EVENTS.CHAT_TYPING, onTyping);
    socket.on(SOCKET_EVENTS.CHAT_STOP_TYPING, onStopTyping);
    socket.on(SOCKET_EVENTS.ROOM_HOST_MUTE, onHostMute);
    socket.on(SOCKET_EVENTS.ROOM_END, onRoomEnd);
    socket.on(SOCKET_EVENTS.ERROR, onSocketError);

    socket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });

    return () => {
      active = false;

      socket.off('connect', onReconnect);
      socket.off(SOCKET_EVENTS.ROOM_PARTICIPANTS, onParticipants);
      socket.off(SOCKET_EVENTS.ROOM_USER_JOINED, onUserJoined);
      socket.off(SOCKET_EVENTS.ROOM_USER_LEFT, onUserLeft);
      socket.off(SOCKET_EVENTS.MEDIA_TOGGLE, onMediaToggle);
      socket.off(SOCKET_EVENTS.CHAT_MESSAGE, onChatMessage);
      socket.off(SOCKET_EVENTS.CHAT_TYPING, onTyping);
      socket.off(SOCKET_EVENTS.CHAT_STOP_TYPING, onStopTyping);
      socket.off(SOCKET_EVENTS.ROOM_HOST_MUTE, onHostMute);
      socket.off(SOCKET_EVENTS.ROOM_END, onRoomEnd);
      socket.off(SOCKET_EVENTS.ERROR, onSocketError);

      socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { meetingId });

      transportRef.current?.close();
      transportRef.current = null;
    };
  }, [socket, meetingId, ice.data, me?.id]);

  // Publishing the local stream is separate from joining, because the lobby
  // may still be acquiring the camera when the roster arrives.
  useEffect(() => {
    if (localStream) transportRef.current?.start(localStream);
  }, [localStream]);

  // A "typing" signal with no stop - a closed tab, a dropped socket - would
  // otherwise leave somebody typing forever.
  useEffect(() => {
    const timer = setInterval(() => {
      setTyping((current) => {
        const cutoff = Date.now() - TYPING_TIMEOUT_MS;
        const live = Object.entries(current).filter(([, value]) => value.at > cutoff);
        return live.length === Object.keys(current).length ? current : Object.fromEntries(live);
      });
    }, 1500);

    return () => clearInterval(timer);
  }, []);

  // --- Actions -------------------------------------------------------------

  const sendChat = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !socket) return;
      socket.emit(SOCKET_EVENTS.CHAT_SEND, { meetingId, text: trimmed });
      socket.emit(SOCKET_EVENTS.CHAT_STOP_TYPING, { meetingId });
    },
    [socket, meetingId],
  );

  const lastTypingAt = useRef(0);
  const notifyTyping = useCallback(() => {
    // Throttled: a keystroke each emits dozens of events a second for nothing.
    const now = Date.now();
    if (now - lastTypingAt.current < 2000 || !socket) return;
    lastTypingAt.current = now;
    socket.emit(SOCKET_EVENTS.CHAT_TYPING, { meetingId });
  }, [socket, meetingId]);

  const publishMediaState = useCallback(
    (state: MediaState) => {
      socket?.emit(SOCKET_EVENTS.MEDIA_TOGGLE, { meetingId, state });
    },
    [socket, meetingId],
  );

  const muteEveryone = useCallback(() => {
    // No targetUserId means everyone but the host - the server's convention.
    socket?.emit(SOCKET_EVENTS.ROOM_HOST_MUTE, { meetingId });
  }, [socket, meetingId]);

  const muteParticipant = useCallback(
    (userId: string) => {
      socket?.emit(SOCKET_EVENTS.ROOM_HOST_MUTE, { meetingId, targetUserId: userId });
    },
    [socket, meetingId],
  );

  const endForEveryone = useCallback(() => {
    socket?.emit(SOCKET_EVENTS.ROOM_END, { meetingId });
  }, [socket, meetingId]);

  const leave = useCallback(() => {
    socket?.emit(SOCKET_EVENTS.ROOM_LEAVE, { meetingId });
    transportRef.current?.close();
  }, [socket, meetingId]);

  const typingNames = useMemo(() => Object.values(typing).map((entry) => entry.name), [typing]);

  return {
    phase: ice.isError ? 'error' : phase,
    error: error ?? (ice.isError ? 'Could not load the connection settings.' : null),
    peers,
    self,
    messages,
    typingNames,
    hasTurn: ice.data?.hasTurn ?? false,
    transport: transportRef.current,
    sendChat,
    notifyTyping,
    publishMediaState,
    muteEveryone,
    muteParticipant,
    endForEveryone,
    leave,
  };
}
