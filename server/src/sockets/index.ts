import type { Server as HttpServer } from 'node:http';
import { Server, type DefaultEventsMap } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { SOCKET_EVENTS, socketRooms } from '@intellmeet/shared';
import { env, isTest } from '../config/env.js';
import { getRedis } from '../config/redis.js';
import { logger } from '../lib/logger.js';
import {
  addUserSocket,
  markOfflineForTeams,
  markOnlineForTeams,
  removeUserSocket,
} from './presence.js';
import { authenticateSocket } from './socket.auth.js';
import { registerHandlers } from './socket.handlers.js';
import type { AppServer, SocketData } from './socket.types.js';

let io: AppServer | undefined;

/**
 * Creates the Socket.io server and attaches it to the existing HTTP listener.
 *
 * Sharing the HTTP server matters on Render's free tier: one web service, one
 * port, so WebSocket and REST have to live on the same listener.
 */
export function createSocketServer(httpServer: HttpServer): AppServer {
  const server = new Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>(
    httpServer,
    {
      // The browser connects straight to Render, bypassing the Vercel rewrite
      // (which cannot proxy a WebSocket upgrade), so this really is a
      // cross-origin connection and needs the same allowlist as REST.
      cors: {
        origin: env.CORS_ORIGINS,
        credentials: true,
      },
      // Start on WebSocket where possible; polling remains as the fallback for
      // networks that block upgrades.
      transports: ['websocket', 'polling'],
      // Render idles a free instance out after inactivity; a tighter ping cycle
      // surfaces a dead connection to the client quickly enough to reconnect.
      pingInterval: 25_000,
      pingTimeout: 20_000,
      // Signalling payloads are small; anything larger is a bug or an attack.
      maxHttpBufferSize: 256 * 1024,
    },
  );

  server.use((socket, next) => {
    void authenticateSocket(socket, next);
  });

  server.on('connection', (socket) => {
    const { user } = socket.data;

    logger.debug({ userId: user.id, socketId: socket.id }, '[socket] connected');

    // A private room per account, so notifications can be addressed to a
    // person rather than to a particular tab.
    void socket.join(socketRooms.user(user.id));

    // ...and one per team, so presence and team-wide events fan out without
    // the server tracking who is interested.
    for (const teamId of user.teamIds) {
      void socket.join(socketRooms.team(teamId));
    }

    void (async () => {
      const cameOnline = await addUserSocket(user.id, socket.id);

      // Only announce on the *first* socket. Without this, opening a second
      // tab would show a colleague blinking offline and online again.
      if (cameOnline) {
        await markOnlineForTeams(user.id, user.teamIds);
        for (const teamId of user.teamIds) {
          socket.to(socketRooms.team(teamId)).emit(SOCKET_EVENTS.PRESENCE_ONLINE, {
            teamId,
            userId: user.id,
          });
        }
      }
    })();

    registerHandlers(server, socket);

    socket.on('disconnect', (reason) => {
      logger.debug({ userId: user.id, reason }, '[socket] disconnected');

      void (async () => {
        const wentOffline = await removeUserSocket(user.id, socket.id);
        if (!wentOffline) return;

        await markOfflineForTeams(user.id, user.teamIds);
        for (const teamId of user.teamIds) {
          server.to(socketRooms.team(teamId)).emit(SOCKET_EVENTS.PRESENCE_OFFLINE, {
            teamId,
            userId: user.id,
          });
        }
      })();
    });
  });

  io = server;
  return server;
}

/**
 * Attaches the Redis adapter so events reach sockets on other instances.
 *
 * Skipped under test, where the suite runs a single in-process server and must
 * not need a live Redis. Separate from `createSocketServer` because the
 * adapter needs two dedicated connections: the subscriber blocks on Redis's
 * pub/sub protocol and cannot issue ordinary commands, so the shared client
 * would be unusable for everything else.
 */
export function attachRedisAdapter(server: AppServer): void {
  if (isTest) return;

  try {
    const pubClient = getRedis().duplicate();
    const subClient = getRedis().duplicate();

    server.adapter(createAdapter(pubClient, subClient));
    logger.info('[socket] redis adapter attached');
  } catch (error) {
    // A single-instance deployment still works without it, so this degrades
    // rather than stopping the server from starting.
    logger.error({ err: error }, '[socket] failed to attach redis adapter');
  }
}

/**
 * The running server, for code outside the socket layer that needs to emit
 * (the REST controllers). Returns undefined before startup and in tests that
 * never create one, so callers must handle its absence.
 */
export function getIo(): AppServer | undefined {
  return io;
}

export function setIo(server: AppServer | undefined): void {
  io = server;
}

export async function closeSocketServer(): Promise<void> {
  if (!io) return;

  await new Promise<void>((resolve) => {
    io?.close(() => resolve());
  });

  io = undefined;
  logger.info('[socket] closed');
}
