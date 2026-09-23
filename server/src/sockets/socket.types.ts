import type { DefaultEventsMap, Server, Socket } from 'socket.io';
import type { UserRole } from '@intellmeet/shared';

/** What every handler can rely on being present on an authenticated socket. */
export interface SocketUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  role: UserRole;
  /** Teams the user belongs to, resolved once at connection time. */
  teamIds: string[];
}

export interface SocketData {
  user: SocketUser;
}

/**
 * Socket.io types `socket.data` through a generic parameter rather than an
 * augmentable interface, so declaring the shape here and threading it through
 * these aliases is the supported way to make `socket.data.user` typed. A
 * `declare module` augmentation of `Socket` collides with the generic instead
 * of refining it.
 *
 * The three event maps are left at their defaults: events are emitted by name
 * from the shared `SOCKET_EVENTS` constants, which is where the real contract
 * lives, and a fully typed event map would duplicate it in a second place that
 * could drift.
 */
export type AppServer = Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

export type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;
