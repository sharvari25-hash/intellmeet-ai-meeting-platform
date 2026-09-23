import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { burnPasswordComparison, hashPassword, verifyPassword } from '../../lib/password.js';
import { User, type UserDocument } from '../users/user.model.js';
import { toPublicUser } from '../users/user.service.js';
import { hashRefreshToken, issueRefreshToken, signAccessToken } from './auth.tokens.js';

/** Where a session was created from, recorded against the refresh token. */
export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface AuthResult {
  body: AuthResponse;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Builds the response for a successful authentication and records the new
 * refresh token against the user.
 *
 * `refreshTokens` is `select: false`, so it is updated with a targeted
 * `$push`/`$pull` rather than by mutating a loaded document - which would
 * write back an empty array and log everyone out.
 */
async function startSession(user: UserDocument, context: SessionContext): Promise<AuthResult> {
  const refresh = issueRefreshToken();

  // Two operations rather than one: MongoDB refuses an update that both
  // `$pull`s from and `$push`es to the same array path ("would create a
  // conflict at 'refreshTokens'"). An ordered bulkWrite applies them in
  // sequence within a single round trip.
  await User.bulkWrite([
    {
      // Housekeeping first: drop tokens that expired while this account was
      // idle, so the array cannot grow without bound over its lifetime.
      updateOne: {
        filter: { _id: user._id },
        update: { $pull: { refreshTokens: { expiresAt: { $lt: new Date() } } } },
      },
    },
    {
      updateOne: {
        filter: { _id: user._id },
        update: {
          $push: {
            refreshTokens: {
              hash: refresh.hash,
              expiresAt: refresh.expiresAt,
              userAgent: context.userAgent,
              ip: context.ip,
            },
          },
        },
      },
    },
  ] as never);

  return {
    body: {
      user: toPublicUser(user),
      accessToken: signAccessToken({ sub: user._id.toString(), role: user.role }),
      expiresInSec: env.ACCESS_TOKEN_TTL_SEC,
    },
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export async function register(input: RegisterInput, context: SessionContext): Promise<AuthResult> {
  const email = input.email.toLowerCase();

  // Checked explicitly for a clear message. The unique index is still the real
  // guarantee - two simultaneous registrations would both pass this check, and
  // the duplicate-key error is translated to CONFLICT by the error handler.
  if (await User.exists({ email })) {
    throw AppError.conflict('An account with that email already exists');
  }

  const user = await User.create({
    name: input.name,
    email,
    passwordHash: await hashPassword(input.password),
    authProvider: 'local',
    role: 'member',
  });

  return startSession(user, context);
}

export async function login(input: LoginInput, context: SessionContext): Promise<AuthResult> {
  const email = input.email.toLowerCase();

  // `passwordHash` is `select: false`, so it must be asked for by name.
  const user = await User.findOne({ email }).select('+passwordHash');

  if (!user?.passwordHash) {
    // Spend the same time as a real comparison would. Returning immediately
    // makes "no such account" measurably faster than "wrong password", which
    // is a reliable account-enumeration oracle.
    await burnPasswordComparison();
    throw AppError.unauthorized('Invalid email or password');
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    // Identical message for both failures, for the same reason.
    throw AppError.unauthorized('Invalid email or password');
  }

  return startSession(user, context);
}

/**
 * Logs in as the shared demo account.
 *
 * Exists so reviewers can use the product without creating an account. It is
 * safe to leave unauthenticated because it grants access to exactly one
 * pre-seeded user and nothing else; if that user has not been seeded, the
 * endpoint reports the feature as unavailable rather than 404-ing confusingly.
 */
export async function demoLogin(context: SessionContext): Promise<AuthResult> {
  const user = await User.findOne({ email: env.DEMO_EMAIL.toLowerCase() });

  if (!user) {
    throw AppError.unavailable(
      'Demo mode is not available: the demo account has not been seeded. Run `npm run seed -w @intellmeet/server`.',
    );
  }

  return startSession(user, context);
}

/**
 * Rotates a refresh token, with reuse detection.
 *
 * Rotation means every refresh invalidates the token that was presented. The
 * old record is kept with `revokedAt` set rather than deleted, which is what
 * makes theft detectable: the legitimate client and an attacker cannot both
 * keep refreshing, so whoever presents the already-rotated token reveals that
 * the token was copied. At that point the safe assumption is that the account
 * is compromised, so *every* session is revoked and both parties must log in
 * again.
 */
export async function refresh(
  presentedToken: string,
  context: SessionContext,
): Promise<AuthResult> {
  const hash = hashRefreshToken(presentedToken);

  // One indexed lookup on `refreshTokens.hash`; no need for the client to tell
  // us who it claims to be.
  const user = await User.findOne({ 'refreshTokens.hash': hash }).select('+refreshTokens');

  if (!user) throw AppError.unauthorized('Invalid or expired session');

  const entry = user.refreshTokens.find((token) => token.hash === hash);
  if (!entry) throw AppError.unauthorized('Invalid or expired session');

  if (entry.revokedAt) {
    // Reuse of a rotated token: revoke everything and make the incident loud.
    await revokeAllSessions(user._id.toString());
    logger.error(
      { userId: user._id.toString(), ip: context.ip, userAgent: context.userAgent },
      '[auth] refresh token reuse detected - all sessions revoked',
    );
    throw AppError.unauthorized('Session revoked. Please sign in again.');
  }

  if (entry.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('Session expired. Please sign in again.');
  }

  const next = issueRefreshToken();

  // Revoke-then-issue, as two ordered operations in one bulkWrite. They cannot
  // be a single update because `$set` on a matched element and `$push` onto
  // the same array conflict in MongoDB.
  //
  // The order is the fail-safe one. If the second operation were lost, the
  // user simply has to sign in again; the reverse order would briefly leave
  // both the old and the new token valid, which is exactly what rotation
  // exists to prevent.
  await User.bulkWrite([
    {
      updateOne: {
        filter: { _id: user._id, 'refreshTokens.hash': hash },
        update: {
          $set: {
            'refreshTokens.$.revokedAt': new Date(),
            'refreshTokens.$.replacedByHash': next.hash,
          },
        },
      },
    },
    {
      updateOne: {
        filter: { _id: user._id },
        update: {
          $push: {
            refreshTokens: {
              hash: next.hash,
              expiresAt: next.expiresAt,
              userAgent: context.userAgent,
              ip: context.ip,
            },
          },
        },
      },
    },
  ] as never);

  return {
    body: {
      user: toPublicUser(user),
      accessToken: signAccessToken({ sub: user._id.toString(), role: user.role }),
      expiresInSec: env.ACCESS_TOKEN_TTL_SEC,
    },
    refreshToken: next.token,
    refreshExpiresAt: next.expiresAt,
  };
}

/**
 * Ends one session.
 *
 * Deliberately never throws: logout must be idempotent, because the client
 * clears its own state regardless. A stale or already-revoked token producing
 * a 401 here would leave the UI stuck on a "signing out…" state.
 */
export async function logout(presentedToken: string | undefined): Promise<void> {
  if (!presentedToken) return;

  await User.updateOne({ 'refreshTokens.hash': hashRefreshToken(presentedToken) }, {
    $pull: { refreshTokens: { hash: hashRefreshToken(presentedToken) } },
  } as never);
}

/** Drops every refresh token for a user, ending all their sessions. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { refreshTokens: [] } } as never);
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await User.findById(userId);
  if (!user) throw AppError.unauthorized('Account no longer exists');
  return toPublicUser(user);
}
