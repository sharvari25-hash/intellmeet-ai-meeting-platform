import type { Request, RequestHandler, Response } from 'express';
import { REFRESH_COOKIE_NAME } from '@intellmeet/shared';
import { clientIp } from '../../lib/clientIp.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as authService from './auth.service.js';
import { clearRefreshCookie, setRefreshCookie } from './auth.tokens.js';

/**
 * Where the session was created from.
 *
 * Stored alongside the refresh token so a future "active sessions" screen can
 * show the user where they are signed in, and so a reuse-detection incident
 * has forensic context in the logs. The user agent is truncated because it is
 * attacker-controlled and unbounded.
 */
function sessionContext(req: Request): authService.SessionContext {
  return {
    userAgent: req.get('user-agent')?.slice(0, 200),
    // The visitor, not the proxy in front of the API (lib/clientIp.ts).
    ip: clientIp(req),
  };
}

/** Sends the auth payload and installs the rotated refresh cookie. */
function sendAuthResult(res: Response, result: authService.AuthResult, status = 200): void {
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  res.status(status).json(result.body);
}

export const register: RequestHandler = async (req, res) => {
  const result = await authService.register(req.body, sessionContext(req));
  sendAuthResult(res, result, 201);
};

export const login: RequestHandler = async (req, res) => {
  sendAuthResult(res, await authService.login(req.body, sessionContext(req)));
};

export const demoLogin: RequestHandler = async (req, res) => {
  // 201: every demo sign-in creates an account.
  sendAuthResult(res, await authService.demoLogin(sessionContext(req)), 201);
};

export const endDemo: RequestHandler = async (req, res) => {
  await authService.endDemoSession(currentUser(req).id);
  // The account is gone, so its refresh cookie is worthless; clear it rather
  // than leave the browser presenting it on the next page load.
  clearRefreshCookie(res);
  res.status(204).send();
};

export const refresh: RequestHandler = async (req, res) => {
  const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME];

  if (!token) {
    // Nothing to rotate. Clear any stale cookie so the browser stops sending it.
    clearRefreshCookie(res);
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'No active session', requestId: req.id },
    });
    return;
  }

  try {
    sendAuthResult(res, await authService.refresh(token, sessionContext(req)));
  } catch (error) {
    // Any refresh failure - expired, unknown, or reuse-detected - means this
    // cookie is worthless. Clearing it stops the client retrying in a loop.
    clearRefreshCookie(res);
    throw error;
  }
};

export const logout: RequestHandler = async (req, res) => {
  const token = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE_NAME];

  await authService.logout(token);
  clearRefreshCookie(res);

  // 204: the client has nothing to read, and logout is idempotent.
  res.status(204).send();
};

export const me: RequestHandler = async (req, res) => {
  res.json({ user: await authService.getMe(currentUser(req).id) });
};
