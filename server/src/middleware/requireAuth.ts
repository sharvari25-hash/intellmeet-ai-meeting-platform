import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { UserRole } from '@intellmeet/shared';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';

/**
 * Requires a valid access token.
 *
 * The token is read from `Authorization: Bearer …`, never from a cookie. That
 * is the deliberate half of the split: the *access* token is sent explicitly
 * by the client on each call, so no browser automatically attaches it to a
 * cross-site request and CSRF is structurally impossible on every protected
 * route. Only the refresh cookie is automatic, and it is scoped to /api/auth.
 *
 * No database round trip: the signature is proof enough for 15 minutes, which
 * is what keeps authenticated requests cheap. The trade-off is that a role
 * change or deletion takes effect at the next refresh rather than instantly -
 * acceptable at a 15-minute ceiling, and the reason the window is short.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.get('authorization');

  if (!header?.startsWith('Bearer ')) {
    next(AppError.unauthorized('Missing Bearer token'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(AppError.unauthorized('Missing Bearer token'));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Requires a platform-wide role. Must be mounted after `requireAuth`.
 *
 * This is *not* the team-level check - a team admin is a different concept
 * (see `requireTeamRole` in the teams module). This one gates cross-tenant
 * operations.
 */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) {
      // Reaching here means the route was misconfigured, not that the caller
      // did anything wrong. 401 is still the correct answer to send outwards.
      next(AppError.unauthorized('Authentication required'));
      return;
    }

    if (!allowed.includes(req.user.role)) {
      next(AppError.forbidden('You do not have permission to perform this action'));
      return;
    }

    next();
  };
}

/**
 * Reads the authenticated user, throwing if the route forgot `requireAuth`.
 *
 * Lets controllers use `req.user.id` without a non-null assertion, and turns a
 * wiring mistake into an immediate, obvious failure instead of a silent
 * `undefined` that reads as "not logged in".
 */
export function currentUser(req: Request): { id: string; role: UserRole } {
  if (!req.user) throw AppError.internal('Route is missing the requireAuth middleware');
  return req.user;
}
