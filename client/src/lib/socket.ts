import { io } from 'socket.io-client';
import { getAccessToken } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import { refreshSession } from './apiClient';

/**
 * Connects the one socket this tab will ever have.
 *
 * A singleton rather than a per-component connection: every extra socket costs
 * a handshake, a row in the presence set and a duplicate of every broadcast,
 * and the presence layer counts sockets per user to decide when someone has
 * really gone offline.
 *
 * Only the authenticated shell imports this module, so socket.io-client is
 * bundled with the shell's chunk and a signed-out visitor never downloads it.
 * Tearing the socket down lives on the store instead (`teardown`), which
 * anything can call without pulling the library in.
 */

/**
 * Where the socket connects.
 *
 * Production needs an absolute URL, because the client is on Vercel and the
 * API is on Render, and a Vercel rewrite cannot carry a WebSocket upgrade.
 * Development uses the same origin and lets Vite proxy it - which is also the
 * only thing that works in the HTTPS dev mode used for phone testing, since an
 * https page is not allowed to open a plain `ws://` connection and would fail
 * as mixed content.
 */
function socketUrl(): string {
  const configured = import.meta.env.VITE_SOCKET_URL;
  const insecure = configured?.startsWith('http://');

  if (!configured || (window.location.protocol === 'https:' && insecure)) {
    return window.location.origin;
  }

  return configured;
}

export function connectSocket(): void {
  if (useSocketStore.getState().socket) return;

  const socket = io(socketUrl(), {
    transports: ['websocket', 'polling'],
    withCredentials: true,
    /**
     * A function, not an object.
     *
     * Socket.io calls it before every connection *and every reconnection*, so
     * a socket that drops while the access token is expiring comes back with
     * the token that exists at that moment rather than the stale one captured
     * when `io()` was first called. An object literal here is the classic
     * cause of "reconnects, then immediately fails auth".
     */
    auth: (cb: (data: Record<string, unknown>) => void) => {
      cb({ token: getAccessToken() });
    },
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });

  socket.on('connect_error', (error: Error) => {
    // The handshake middleware rejects with a plain Error, so the message is
    // all we get. A rejected handshake is usually just an expired access
    // token: refresh, and the manager's own backoff retries with the new one
    // because `auth` is re-evaluated on each attempt.
    void refreshSession().then((token) => {
      if (!token) {
        // The refresh cookie is gone too, so retrying forever would only
        // hammer the server while the user sits on a dead page.
        useSocketStore.getState().teardown();
      }
    });

    if (import.meta.env.DEV) console.warn('[socket] connect_error:', error.message);
  });

  useSocketStore.getState().setSocket(socket);
}
