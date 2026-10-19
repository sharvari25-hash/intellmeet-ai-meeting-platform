import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { burnPasswordComparison, hashPassword, verifyPassword } from '../../lib/password.js';
import { removeGuests } from '../demo/demo.cleanup.js';
import { createDemoGuest } from '../demo/demo.guests.js';
import { User, type UserDocument } from '../users/user.model.js';
import { toPublicUser } from '../users/user.service.js';
import {
  hashRefreshToken,
  issueRefreshToken,
  signAccessToken,
  type IssuedRefreshToken,
} from './auth.tokens.js';

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
 * The two array operations every token write performs, as an ordered
 * bulkWrite.
 *
 * They cannot be one update: MongoDB refuses an update that touches the same
 * array path twice ("would create a conflict at 'refreshTokens'"). An ordered
 * bulkWrite applies them in sequence within a single round trip.
 *
 * `$sort` + `$slice: -N` is what caps the array. Sorting ascending by
 * `createdAt` and keeping the last N leaves the N most recent sessions, so a
 * heavily shared account - a seeded team-mate that every reviewer signs in as
 * for the second seat in a call - cannot grow an unbounded document. Expired
 * entries are pulled first so the cap is spent on live sessions rather than on
 * dead ones.
 *
 * The `createdAt` stamp doubles as "last active": the demo cleanup removes a
 * guest whose newest token is older than its cutoff.
 */
function pushTokenOps(userId: unknown, refresh: IssuedRefreshToken, context: SessionContext) {
  return [
    {
      updateOne: {
        filter: { _id: userId },
        update: { $pull: { refreshTokens: { expiresAt: { $lt: new Date() } } } },
      },
    },
    {
      updateOne: {
        filter: { _id: userId },
        update: {
          $push: {
            refreshTokens: {
              $each: [
                {
                  hash: refresh.hash,
                  familyId: refresh.familyId,
                  expiresAt: refresh.expiresAt,
                  createdAt: new Date(),
                  userAgent: context.userAgent,
                  ip: context.ip,
                },
              ],
              $sort: { createdAt: 1 },
              $slice: -env.MAX_SESSIONS_PER_USER,
            },
          },
        },
      },
    },
  ];
}

/**
 * Builds the response for a successful authentication and records a new
 * refresh token against the user, starting a fresh token family.
 *
 * `refreshTokens` is `select: false`, so it is updated with targeted update
 * operators rather than by mutating a loaded document - which would write back
 * an empty array and log every session out.
 */
export async function startSession(
  user: UserDocument,
  context: SessionContext,
): Promise<AuthResult> {
  const refresh = issueRefreshToken();

  await User.bulkWrite(pushTokenOps(user._id, refresh, context) as never);

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
 * Starts a demo session as a brand-new guest.
 *
 * Exists so reviewers can use the product without creating an account. Every
 * call is a different person - a generated name, a member of the seeded demo
 * team - so two reviewers (or two windows) can meet each other, and neither is
 * the host of the other's meetings. It is safe to leave unauthenticated
 * because a guest can reach the demo team and nothing else, and the number of
 * guests is capped. If the demo team has not been seeded, the endpoint reports
 * the feature as unavailable rather than 404-ing confusingly.
 */
export async function demoLogin(context: SessionContext): Promise<AuthResult> {
  return startSession(await createDemoGuest(), context);
}

/**
 * Ends a guest's demo session for good: the guest account is deleted, with
 * the meetings it hosted and the teams it created.
 *
 * A guest has no password, so after signing out nobody can ever act as it
 * again; this lets a reviewer leave nothing behind instead of waiting for the
 * sweep. Refused for real accounts - deleting those is a different feature
 * with its own confirmation and data-export obligations. Idempotent: an
 * account that is already gone is not an error.
 */
export async function endDemoSession(userId: string): Promise<void> {
  const user = await User.findById(userId).select('authProvider');
  if (!user) return;

  if (user.authProvider !== 'guest') {
    throw AppError.forbidden('Only a demo guest session can be ended this way. Sign out instead.');
  }

  const removed = await removeGuests([user._id]);
  logger.info({ userId, ...removed }, '[demo] guest ended their session');
}

/**
 * Rotates a refresh token, with reuse detection.
 *
 * Rotation means every refresh invalidates the token that was presented. The
 * old record is kept with `revokedAt` set rather than deleted, which is what
 * makes theft detectable: whoever presents an already-rotated token reveals
 * that the token was copied.
 *
 * Two things bound the damage of that detection firing:
 *
 * 1. **Only the token's family is revoked**, never the whole account. A family
 *    is one sign-in plus all of its rotations, so a compromised session cannot
 *    sign out the account's other devices - or, for a seeded team-mate that
 *    several reviewers sign in as, everyone else using it at that moment.
 *
 * 2. **A short grace window** (`REFRESH_REUSE_GRACE_MS`) treats a replay as a
 *    concurrent refresh rather than theft, provided the family still has a
 *    live token. Two browser tabs refresh independently - each tab is its own
 *    JavaScript context, so the client's single-flight queue cannot merge them
 *    - and without this, opening a second tab would reliably look like an
 *    attack. The cost is that a genuinely stolen token is accepted for up to
 *    the grace window after it was rotated; set the window to 0 to disable it.
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
    const now = Date.now();
    const withinGrace = now - entry.revokedAt.getTime() <= env.REFRESH_REUSE_GRACE_MS;

    // The family must still be alive for this to be a plausible race. Checking
    // the family rather than the one direct successor also covers a tab that
    // rotated twice while the other tab was still in flight.
    const familyIsLive = user.refreshTokens.some(
      (token) =>
        token.familyId === entry.familyId && !token.revokedAt && token.expiresAt.getTime() > now,
    );

    if (!withinGrace || !familyIsLive) {
      await revokeFamily(user._id.toString(), entry.familyId);
      logger.error(
        {
          userId: user._id.toString(),
          familyId: entry.familyId,
          ip: context.ip,
          userAgent: context.userAgent,
        },
        '[auth] refresh token reuse detected - session family revoked',
      );
      throw AppError.unauthorized('Session revoked. Please sign in again.');
    }

    // A legitimate concurrent refresh. Issue a sibling token in the same
    // family rather than rejecting. The successor's raw value was never
    // stored - only its hash - so it cannot be handed back a second time.
    logger.debug(
      { userId: user._id.toString(), familyId: entry.familyId },
      '[auth] concurrent refresh within the grace window',
    );

    const sibling = issueRefreshToken(entry.familyId);
    await User.bulkWrite(pushTokenOps(user._id, sibling, context) as never);

    return buildAuthResult(user, sibling);
  }

  if (entry.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('Session expired. Please sign in again.');
  }

  // Stay in the same family: this is the same sign-in, one rotation later.
  const next = issueRefreshToken(entry.familyId);

  // Revoke-then-issue, as ordered operations in one bulkWrite. They cannot be
  // a single update because `$set` on a matched element, `$pull`, and `$push`
  // all touch the same array path.
  //
  // The order is the fail-safe one. If a later operation were lost, the user
  // simply has to sign in again; the reverse order would briefly leave both
  // the old and the new token valid, which is exactly what rotation prevents.
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
    ...pushTokenOps(user._id, next, context),
  ] as never);

  return buildAuthResult(user, next);
}

function buildAuthResult(user: UserDocument, refresh: IssuedRefreshToken): AuthResult {
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

/**
 * Ends one sign-in and every rotation descended from it.
 *
 * This is the blast radius of reuse detection. Scoping it to the family rather
 * than the account follows the OAuth 2.0 Security BCP, which revokes the
 * tokens issued for the affected *grant*, and is what keeps one device's
 * mishap off every other session the same account has open.
 */
export async function revokeFamily(userId: string, familyId: string): Promise<void> {
  await User.updateOne({ _id: userId }, { $pull: { refreshTokens: { familyId } } } as never);
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

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await User.findById(userId);
  if (!user) throw AppError.unauthorized('Account no longer exists');
  return toPublicUser(user);
}
