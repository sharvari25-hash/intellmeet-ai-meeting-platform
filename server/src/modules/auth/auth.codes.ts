import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  LOGIN_CODE_LENGTH,
  type LoginCodeSent,
  type RequestLoginCodeInput,
  type VerifyLoginCodeInput,
} from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { getEmailProvider } from '../../lib/email/index.js';
import { renderSignInEmail, type SignInEmail } from '../../lib/email/templates.js';
import type { EmailProvider } from '../../lib/email/types.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { DEMO_TEAMMATES } from '../demo/demo.constants.js';
import { User, type UserDocument } from '../users/user.model.js';
import { startSession, type AuthResult, type SessionContext } from './auth.service.js';
import { LoginCode, type LoginCodeEntry } from './loginCode.model.js';

/**
 * Signing in and signing up with a code sent by email.
 *
 * Two steps. `requestCode` emails a six-digit code; `verifyCode` takes it and
 * starts a session exactly as a password sign-in does (same tokens, same
 * cookie), creating the account first if the code was for a sign-up.
 *
 * Three rules shape it:
 *
 * 1. **The answer to "send me a code" never depends on whether an account
 *    exists.** Every address gets the same response; what differs is the email.
 *    An address with no account that asks to sign in is told so, and one that
 *    already has an account and asks to sign up is told to sign in. The
 *    person always learns what to do, and a stranger typing addresses into the
 *    form learns nothing.
 * 2. **A code is worth five guesses.** The attempt counter is incremented in
 *    the same atomic update that finds the code, so parallel requests cannot
 *    all slip in under the ceiling, and a correct code is deleted in one
 *    conditional operation, so it cannot be used twice.
 * 3. **Proving an address takes over an unproven account.** See `claimAccount`.
 */

/** The one failure for every way a code can be wrong: absent, expired, spent, guessed out. */
function invalidCode(): AppError {
  return AppError.unauthorized('That code is incorrect or has expired. Request a new one.');
}

function generateLoginCode(): string {
  // randomInt is uniform over the range; `% 1e6` on random bytes would not be.
  return randomInt(0, 10 ** LOGIN_CODE_LENGTH)
    .toString()
    .padStart(LOGIN_CODE_LENGTH, '0');
}

/**
 * The value stored in place of a code.
 *
 * An HMAC, not a bare hash: a six-digit code has only a million values, so a
 * plain SHA-256 of one is undone by trying them all. Keyed with the server's
 * secret and bound to the address, a database dump alone cannot be used to
 * recover a code, or to carry one from one address to another. The code is
 * short-lived and guess-limited as well; this is the layer behind those.
 */
function hashLoginCode(email: string, code: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(`login-code:${email}:${code}`).digest('hex');
}

function hashesMatch(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, 'hex');
  const b = Buffer.from(presented, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Addresses a code can never be sent to, and never signs in to.
 *
 * The seeded team-mates and the demo persona have passwords and sample data
 * that every reviewer shares; their addresses are made up, and if anyone came
 * to own one of those domains, a code would be a way into the demo team's
 * seeded accounts. Guests use the reserved `.invalid` top level, which no
 * mailbox can have.
 */
function isReservedEmail(email: string): boolean {
  return (
    email === env.DEMO_EMAIL.toLowerCase() ||
    email.endsWith('.invalid') ||
    DEMO_TEAMMATES.some((mate) => mate.email === email)
  );
}

type Outcome = SignInEmail['kind'] | null;

/** What to send to an address, or nothing. */
async function outcomeFor(input: RequestLoginCodeInput): Promise<Outcome> {
  if (isReservedEmail(input.email)) return null;

  const user = await User.findOne({ email: input.email }).select('authProvider');

  if (input.purpose === 'login') {
    if (!user) return 'no-account';
    // A guest or the demo persona has no way in but its own flow.
    return user.authProvider === 'local' ? 'code' : null;
  }

  return user ? 'has-account' : 'code';
}

async function deliver(provider: EmailProvider, to: string, email: SignInEmail): Promise<void> {
  try {
    await provider.send({ to, ...renderSignInEmail(email) });
  } catch (error) {
    // The vendor's reason goes to the log (never the key: see EmailError);
    // the person gets something they can act on.
    logger.error({ err: error, provider: provider.name }, '[auth] sign-in email was not sent');
    throw AppError.unavailable("We couldn't send the email. Please try again in a moment.", {
      cause: error,
    });
  }
}

/**
 * Emails what the address needs: a code, or a note about its account.
 *
 * The caller has already been through the per-address and global limits, so
 * every request that reaches here sends at most one email.
 */
export async function requestCode(input: RequestLoginCodeInput): Promise<LoginCodeSent> {
  // First, so a server with no way to send email says so before touching the
  // database or minting a code.
  const provider = getEmailProvider();

  const { email } = input;
  const outcome = await outcomeFor(input);
  const sent: LoginCodeSent = {
    expiresInSec: env.LOGIN_CODE_TTL_MIN * 60,
    resendAfterSec: env.LOGIN_CODE_RESEND_SEC,
  };

  if (outcome === 'code') {
    const code = generateLoginCode();
    const codeHash = hashLoginCode(email, code);

    // Replaces whatever was waiting, attempts and all: only the newest code
    // works. (Asking again is limited per address, so this cannot be used to
    // reset the guess counter faster than the limit allows.)
    await LoginCode.updateOne(
      { email },
      {
        $set: {
          purpose: input.purpose,
          codeHash,
          attempts: 0,
          expiresAt: new Date(Date.now() + env.LOGIN_CODE_TTL_MIN * 60 * 1000),
          ...(input.purpose === 'register' ? { name: input.name } : {}),
        },
        ...(input.purpose === 'login' ? { $unset: { name: '' } } : {}),
      },
      { upsert: true },
    );

    try {
      await deliver(provider, email, { kind: 'code', code, ttlMinutes: env.LOGIN_CODE_TTL_MIN });
    } catch (error) {
      // A code nobody received should not stay valid.
      await LoginCode.deleteOne({ email, codeHash });
      throw error;
    }
  } else if (outcome === 'no-account') {
    await deliver(provider, email, {
      kind: 'no-account',
      signUpUrl: new URL('/register', env.CLIENT_URL).toString(),
    });
  } else if (outcome === 'has-account') {
    await deliver(provider, email, {
      kind: 'has-account',
      signInUrl: new URL('/login', env.CLIENT_URL).toString(),
    });
  }

  return sent;
}

/**
 * Takes over an account whose address nobody had proven.
 *
 * An account made with a password (`POST /api/auth/register`) never had its
 * address checked, so whoever made it may not own the address. If an attacker
 * registers `victim@example.com` with a password only they know, and the
 * victim later signs up with a code, signing the victim in to that account
 * would hand them an account the attacker can still enter. So the first time
 * the address is proven, the account is marked verified and everything the
 * unproven holder had is revoked: the password, and every session.
 *
 * The cost is that a person who made a password account with their own
 * address and later uses a code loses the password. They have just proven they
 * own the address, so the code works for them again next time; the other way
 * round, nothing could tell them from the attacker. (This is also what
 * Firebase Authentication does.)
 */
async function claimAccount(user: UserDocument): Promise<void> {
  await User.updateOne({ _id: user._id }, {
    $set: { emailVerifiedAt: new Date(), refreshTokens: [] },
    $unset: { passwordHash: '' },
  } as never);
  logger.warn(
    { userId: user._id.toString() },
    '[auth] unverified account claimed by a code: password and sessions removed',
  );
}

/** The account a verified code belongs to, created if it was for a sign-up. */
async function accountFor(entry: LoginCodeEntry): Promise<UserDocument> {
  const existing = await User.findOne({ email: entry.email });

  if (!existing) {
    // A sign-in code is only ever issued for an account that exists, so the
    // account was deleted in the meantime.
    if (entry.purpose !== 'register' || !entry.name) throw invalidCode();

    return User.create({
      name: entry.name,
      email: entry.email,
      authProvider: 'local',
      role: 'member',
      emailVerifiedAt: new Date(),
    });
  }

  // Also the case of a sign-up code for an address that gained an account
  // since the code was sent: the code proves the address, so it signs in.
  if (existing.authProvider !== 'local' || isReservedEmail(entry.email)) throw invalidCode();
  if (!existing.emailVerifiedAt) await claimAccount(existing);

  return existing;
}

export async function verifyCode(
  input: VerifyLoginCodeInput,
  context: SessionContext,
): Promise<AuthResult> {
  const { email, code } = input;

  // Find the live code and count this guess in one step. Counting afterwards
  // would let a burst of parallel requests each see "attempts: 0".
  const entry = await LoginCode.findOneAndUpdate(
    {
      email,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: env.LOGIN_CODE_MAX_ATTEMPTS },
    },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!entry) throw invalidCode();

  if (!hashesMatch(entry.codeHash, hashLoginCode(email, code))) {
    if (entry.attempts >= env.LOGIN_CODE_MAX_ATTEMPTS) {
      await LoginCode.deleteOne({ _id: entry._id });
    }
    throw invalidCode();
  }

  // Spend it. Conditional on the document still being this one, so two
  // requests carrying the right code cannot both pass: one deletes it, the
  // other finds nothing to delete.
  const spent = await LoginCode.deleteOne({ _id: entry._id, codeHash: entry.codeHash });
  if (spent.deletedCount !== 1) throw invalidCode();

  return startSession(await accountFor(entry), context);
}
