import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';
import { authPayload } from '@/test/utils';
import { connectSocket } from './socket';

/**
 * Socket.io's client, reduced to what `connectSocket` touches.
 *
 * The one property that matters is `active`. The real client leaves it true
 * after a transport failure, because its manager is still retrying, and sets
 * it false when the server's handshake middleware refuses the connection,
 * after which nothing retries unless `connect()` is called. Both behaviours
 * were checked against socket.io-client 4.8 before these tests were written.
 */
const { FakeSocket, sockets, refreshSession } = vi.hoisted(() => {
  type Auth = (cb: (data: Record<string, unknown>) => void) => void;

  class FakeSocket {
    active = true;
    readonly connect = vi.fn(() => {
      this.active = true;
      return this;
    });
    readonly disconnect = vi.fn(() => {
      this.active = false;
      return this;
    });
    readonly removeAllListeners = vi.fn(() => this);
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(readonly options: { auth: Auth }) {}

    on(event: string, listener: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }

    fire(event: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    /** The token the next handshake would carry. */
    handshakeToken(): unknown {
      let token: unknown;
      this.options.auth((data) => {
        token = data.token;
      });
      return token;
    }
  }

  return {
    FakeSocket,
    sockets: [] as InstanceType<typeof FakeSocket>[],
    refreshSession: vi.fn<() => Promise<string | null>>(),
  };
});

vi.mock('socket.io-client', () => ({
  io: (_url: string, options: ConstructorParameters<typeof FakeSocket>[0]) => {
    const socket = new FakeSocket(options);
    sockets.push(socket);
    return socket;
  },
}));

vi.mock('./apiClient', () => ({ refreshSession }));

function open() {
  connectSocket();
  const socket = sockets.at(-1);
  if (!socket) throw new Error('connectSocket created no socket');
  return socket;
}

/** What socket.io-client does when the handshake middleware says no. */
function refuse(socket: InstanceType<typeof FakeSocket>) {
  socket.active = false;
  socket.fire('connect_error', new Error('Invalid or expired token'));
}

describe('the socket connection', () => {
  beforeEach(() => {
    sockets.length = 0;
    refreshSession.mockReset();
    useSocketStore.setState({ socket: null });
    useAuthStore.setState({
      status: 'authenticated',
      user: authPayload().user as never,
      accessToken: 'old-token',
    });
    // `connect_error` is logged in development builds, which tests are.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rides out an unreachable server without refreshing or signing out', () => {
    const socket = open();

    // A dropped network or a restarting API: every retry fails, and the
    // manager, still active, keeps retrying by itself.
    socket.fire('connect_error', new Error('websocket error'));
    socket.fire('connect_error', new Error('websocket error'));

    expect(refreshSession).not.toHaveBeenCalled();
    expect(useSocketStore.getState().socket).toBe(socket);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('refreshes and reconnects when the token expired while it was down', async () => {
    refreshSession.mockImplementation(async () => {
      useAuthStore.getState().setAccessToken('fresh-token');
      return 'fresh-token';
    });
    const socket = open();
    expect(socket.handshakeToken()).toBe('old-token');

    refuse(socket);

    await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
    expect(socket.handshakeToken()).toBe('fresh-token');
    expect(useSocketStore.getState().socket).toBe(socket);
  });

  it('closes the socket when the session cannot be refreshed', async () => {
    refreshSession.mockResolvedValue(null);
    const socket = open();

    refuse(socket);

    await vi.waitFor(() => expect(useSocketStore.getState().socket).toBeNull());
    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('gives up when fresh tokens keep being refused, counting afresh after a connection', async () => {
    refreshSession.mockResolvedValue('fresh-token');
    const socket = open();

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      refuse(socket);
      await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(attempt));
    }

    // A successful connection starts the count again.
    socket.fire('connect');
    for (let attempt = 4; attempt <= 6; attempt += 1) {
      refuse(socket);
      await vi.waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(attempt));
    }

    // A fourth refusal in a row: the server rejects the account, not the token.
    refuse(socket);

    expect(useSocketStore.getState().socket).toBeNull();
    expect(refreshSession).toHaveBeenCalledTimes(6);
  });

  it('does not reconnect a socket that was torn down while the refresh was in flight', async () => {
    let settle: (token: string | null) => void = () => undefined;
    refreshSession.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const socket = open();

    refuse(socket);
    // Signed out in the meantime.
    useSocketStore.getState().teardown();
    settle('fresh-token');
    // Lets the refresh's continuation run: every pending microtask settles
    // before a zero-delay timer fires.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(socket.connect).not.toHaveBeenCalled();
  });
});
