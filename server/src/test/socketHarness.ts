import { createServer, type Server as HttpServer } from 'node:http';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../app.js';
import { createSocketServer, setIo } from '../sockets/index.js';
import type { AppServer } from '../sockets/socket.types.js';

/**
 * Boots a real HTTP + Socket.io server on an ephemeral port.
 *
 * The integration tests connect over an actual WebSocket rather than calling
 * handlers directly, because most of what can go wrong in this layer -
 * handshake auth, room membership, broadcast-excludes-sender, disconnect
 * cleanup - only exists in the transport. Port 0 lets the OS pick a free port,
 * so suites can run without colliding.
 */
export interface SocketHarness {
  url: string;
  io: AppServer;
  close: () => Promise<void>;
}

export async function startSocketServer(): Promise<SocketHarness> {
  const httpServer: HttpServer = createServer(createApp());
  const io = createSocketServer(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected the test server to bind to a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    io,
    close: async () => {
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      // The module-level singleton would otherwise point at a dead server.
      setIo(undefined);
    },
  };
}

/**
 * Connects a client and resolves once the handshake has succeeded.
 *
 * Forces the WebSocket transport: the polling fallback adds an HTTP round trip
 * per test and makes timing-sensitive assertions flakier for no extra coverage.
 */
export function connectClient(url: string, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect(url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5_000,
    });

    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (error) => reject(error));
  });
}

/** Resolves with the first payload of `event`, or rejects after `timeoutMs`. */
export function waitFor<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 4_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}"`));
    }, timeoutMs);

    function onEvent(payload: T) {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

/** Closes a set of clients and waits for their disconnects to settle. */
export async function closeClients(...clients: (ClientSocket | undefined)[]): Promise<void> {
  for (const client of clients) {
    client?.disconnect();
  }

  // Give the server's disconnect handlers a tick to run their cleanup before
  // the next test wipes the database underneath them.
  await new Promise((resolve) => setTimeout(resolve, 50));
}
