import { logger } from '../lib/logger.js';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';
import { Team } from '../modules/teams/team.model.js';
import { User } from '../modules/users/user.model.js';
import type { AppSocket } from './socket.types.js';

/**
 * Authenticates the WebSocket handshake.
 *
 * The token arrives in `handshake.auth.token`, **not** in a cookie. Two
 * reasons:
 *
 * 1. The socket connects directly to Render, while REST goes through the
 *    Vercel rewrite. A cookie scoped to the Vercel origin is simply not sent
 *    on that cross-origin WebSocket, and one scoped to Render would be a
 *    third-party cookie that browsers increasingly block.
 * 2. `Sec-WebSocket-Protocol` is the only header a browser lets JavaScript set
 *    on a WebSocket, so an `Authorization` header is not an option either.
 *    Socket.io's `auth` payload is the supported channel.
 *
 * The user's profile and team list are loaded once here rather than on every
 * event: a chat message would otherwise cost two extra queries just to know
 * who sent it.
 */
export async function authenticateSocket(
  socket: AppSocket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const auth = socket.handshake.auth as { token?: unknown };
    const token = typeof auth.token === 'string' ? auth.token : undefined;

    if (!token) {
      next(new Error('Missing authentication token'));
      return;
    }

    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.sub).select('name avatarUrl role');
    if (!user) {
      // The token verified, but the account is gone. Treat as unauthenticated.
      next(new Error('Account no longer exists'));
      return;
    }

    const teams = await Team.find({ 'members.userId': user._id }).select('_id');

    socket.data.user = {
      id: user._id.toString(),
      name: user.name,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      teamIds: teams.map((team) => team._id.toString()),
    };

    next();
  } catch (error) {
    // Includes an expired access token, which is routine: the client refreshes
    // and reconnects. Logged at debug so it does not look like an incident.
    logger.debug({ err: error }, '[socket] handshake rejected');
    next(new Error('Invalid or expired token'));
  }
}
