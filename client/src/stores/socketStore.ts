import { create } from 'zustand';
import type { Socket } from 'socket.io-client';

interface SocketState {
  /** The live socket, or null when signed out. Null is a normal state. */
  socket: Socket | null;
  setSocket: (socket: Socket) => void;
  /** Closes the socket and forgets it. Idempotent. */
  teardown: () => void;
}

/**
 * The socket, held in a store rather than a module variable.
 *
 * A plain variable would be simpler but subtly wrong: React runs effects
 * bottom-up, so a component that wants to subscribe to socket events mounts
 * and runs its effect *before* the shell above it has connected. Reading the
 * variable at that moment gives null, the listener is never attached, and the
 * bug only shows up as "notifications work after a refresh".
 *
 * A store makes the socket a value components can depend on, so the effect
 * re-runs the moment it exists, whatever the mount order.
 *
 * `type Socket` is imported as a type only, so nothing that touches this store
 * pulls socket.io-client into its bundle - which is what keeps the client
 * library out of the public pages entirely.
 */
export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,

  setSocket: (socket) => set({ socket }),

  teardown: () => {
    const { socket } = get();
    if (!socket) return;

    // `disconnect()` alone is not enough: the manager would keep trying to
    // reconnect, and the previous session's listeners would still be attached
    // when the next user signs in.
    socket.removeAllListeners();
    socket.disconnect();
    set({ socket: null });
  },
}));
