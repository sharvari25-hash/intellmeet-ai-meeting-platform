import { createHash } from 'node:crypto';
import type { Response } from 'express';
import jwt from 'jsonwebtoken';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, type UserRole } from '@intellmeet/shared';
import { env, isProduction } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { generateOpaqueToken } from '../../lib/ids.js';

const ISSUER = 'intellmeet';
const AUDIENCE = 'intellmeet-api';

export interface AccessTokenPayload {
  /** User id. `sub` is the registered JWT claim for the subject. */
  sub: string;
  role: UserRole;
}

/**
 * Signs a short-lived access token.
 *
 * The payload is deliberately minimal - id and role only. Anything else (name,
 * email, avatar) would be a stale copy the moment the user edits their
 * profile, and the token is not encrypted, merely signed: everything in it is
 * readable by anyone holding it.
 *
 * `issuer`/`audience` are set and verified so a token minted for some other
 * service that happens to share the secret cannot be replayed here.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/**
 * Verifies an access token, translating every jsonwebtoken failure mode into
 * our own 401 so callers never have to know the library's error classes.
 * Phase 3's Socket.io handshake middleware reuses this.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof decoded === 'string' || !decoded.sub || typeof decoded.sub !== 'string') {
      throw AppError.unauthorized('Malformed access token');
    }

    return { sub: decoded.sub, role: (decoded as { role?: UserRole }).role ?? 'member' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized('Access token expired');
    }
    throw AppError.unauthorized('Invalid access token');
  }
}

/**
 * Hashes a refresh token for storage and lookup.
 *
 * SHA-256, not bcrypt: the token is 256 bits of CSPRNG output, so there is no
 * low-entropy guess to slow down, and a deterministic digest is what makes an
 * indexed lookup (and therefore reuse detection) possible at all.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedRefreshToken {
  /** The value sent to the browser. Never stored. */
  token: string;
  /** The value stored in the database. */
  hash: string;
  expiresAt: Date;
}

export function issueRefreshToken(): IssuedRefreshToken {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, hash: hashRefreshToken(token), expiresAt };
}

/**
 * Cookie attributes for the refresh token.
 *
 * - `httpOnly`  - JavaScript cannot read it, so an XSS payload cannot steal
 *                 the long-lived credential (the access token, which it could
 *                 steal, expires in 15 minutes).
 * - `secure`    - HTTPS only, in production. Left off locally so http works.
 * - `sameSite: 'lax'` - blocks the cookie on cross-site sub-requests. This is
 *                 viable only because REST goes through the Vercel rewrite, so
 *                 the browser sees the API as same-origin and the cookie stays
 *                 first-party. Hitting Render directly would need `none`, and
 *                 third-party cookie blocking would then break refresh.
 * - `path`      - scoped to /api/auth, so it is not attached to ordinary calls.
 */
function refreshCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions(expiresAt.getTime() - Date.now()));
}

/**
 * Clears the cookie.
 *
 * The attributes must match the ones it was set with (notably `path`), or the
 * browser treats it as a different cookie and quietly keeps the original.
 */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: REFRESH_COOKIE_PATH,
  });
}
