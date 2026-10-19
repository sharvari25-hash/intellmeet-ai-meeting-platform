import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { apiErrorSchema, authResponseSchema, loginCodeSentSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { EmailError } from '../../lib/email/index.js';
import { CODE_EMAILS_PER_ADDRESS_PER_15_MIN, resetRateLimits } from '../../middleware/rateLimit.js';
import {
  VALID_PASSWORD,
  bearer,
  extractRefreshCookie,
  registerUser,
  uniqueEmail,
} from '../../test/fixtures.js';
import { installMailbox, removeMailbox, type Mailbox } from '../../test/mailbox.js';
import { User } from '../users/user.model.js';
import { LoginCode } from './loginCode.model.js';

const app = createApp();

let mailbox: Mailbox;

beforeEach(() => {
  mailbox = installMailbox();
});

afterEach(() => {
  removeMailbox();
  vi.useRealTimers();
});

const signUpBody = (email: string, name = 'Ada Lovelace') => ({
  purpose: 'register',
  email,
  name,
});

const signInBody = (email: string) => ({ purpose: 'login', email });

function askForCode(body: Record<string, unknown>) {
  return request(app).post('/api/auth/code').send(body);
}

function enterCode(email: string, code: string) {
  return request(app).post('/api/auth/code/verify').send({ email, code });
}

/** Signs up with a code, returning the session. */
async function signUp(email: string, name?: string) {
  await askForCode(signUpBody(email, name)).expect(202);
  const response = await enterCode(email, mailbox.codeFor(email)).expect(200);
  return {
    body: response.body as { user: { id: string }; accessToken: string },
    cookie: extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]),
  };
}

/**
 * Moves the clock forward, so the rate limiters' windows and a code's expiry
 * can be crossed without waiting. Only `Date` is mocked (no fake timers):
 * sockets, the database driver and the test runner keep their real ones. Can
 * be called again to move it further; `afterEach` puts the real clock back.
 */
function jumpForward(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

describe('POST /api/auth/code', () => {
  it('emails a six-digit code to a new address that wants to sign up', async () => {
    const email = uniqueEmail();

    const response = await askForCode(signUpBody(email)).expect(202);

    expect(loginCodeSentSchema.parse(response.body)).toEqual({
      expiresInSec: env.LOGIN_CODE_TTL_MIN * 60,
      resendAfterSec: env.LOGIN_CODE_RESEND_SEC,
    });

    expect(mailbox.sent).toHaveLength(1);
    const [message] = mailbox.sent;
    expect(message?.to).toBe(email);
    expect(message?.text).toMatch(/\b\d{6}\b/);
    expect(message?.html).toContain(mailbox.codeFor(email));
    // A subject shows on a lock screen.
    expect(message?.subject).not.toMatch(/\d{6}/);
  });

  it('stores only a keyed hash of the code, with the name for a sign-up', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email, 'Grace Hopper')).expect(202);

    const stored = await LoginCode.findOne({ email });
    expect(stored?.purpose).toBe('register');
    expect(stored?.name).toBe('Grace Hopper');
    expect(stored?.attempts).toBe(0);
    expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.codeHash).not.toContain(mailbox.codeFor(email));
  });

  it('emails a code to an existing account that wants to sign in', async () => {
    const user = await registerUser(app);

    await askForCode(signInBody(user.email)).expect(202);

    expect(mailbox.to(user.email)).toHaveLength(1);
    expect(mailbox.codeFor(user.email)).toMatch(/^\d{6}$/);
    expect((await LoginCode.findOne({ email: user.email }))?.purpose).toBe('login');
  });

  it('answers identically whether or not the address has an account', async () => {
    const known = await registerUser(app);
    const unknown = uniqueEmail();

    const forKnown = await askForCode(signInBody(known.email)).expect(202);
    const forUnknown = await askForCode(signInBody(unknown)).expect(202);

    // The status and the body: the only difference is the email each gets.
    expect(forUnknown.body).toEqual(forKnown.body);
  });

  it('tells an address with no account how to create one, without a code', async () => {
    const email = uniqueEmail();

    await askForCode(signInBody(email)).expect(202);

    const [message] = mailbox.to(email);
    expect(message?.subject).toMatch(/no intellmeet account/i);
    expect(message?.text).toContain('/register');
    expect(message?.text).not.toMatch(/\b\d{6}\b/);
    expect(await LoginCode.countDocuments({ email })).toBe(0);
  });

  it('tells an address that already has an account to sign in, without a code', async () => {
    const user = await registerUser(app);

    await askForCode(signUpBody(user.email)).expect(202);

    const [message] = mailbox.to(user.email);
    expect(message?.subject).toMatch(/already have/i);
    expect(message?.text).toContain('/login');
    expect(message?.text).not.toMatch(/\b\d{6}\b/);
    expect(await LoginCode.countDocuments({ email: user.email })).toBe(0);
  });

  it('never sends anything for the seeded team-mates or a guest address', async () => {
    for (const email of [
      'ada@intellmeet.app',
      env.DEMO_EMAIL,
      'guest-abc123@guest.intellmeet.invalid',
    ]) {
      await askForCode(signInBody(email)).expect(202);
      // The same address again is held by its cooldown, so clear the counters.
      resetRateLimits();
      await askForCode(signUpBody(email)).expect(202);
      resetRateLimits();
    }

    expect(mailbox.sent).toHaveLength(0);
    expect(await LoginCode.countDocuments()).toBe(0);
  });

  it('sends no code to a guest or demo account that has the address', async () => {
    const email = uniqueEmail('guest');
    await User.create({ name: 'Guest', email, authProvider: 'guest' });

    await askForCode(signInBody(email)).expect(202);

    expect(mailbox.sent).toHaveLength(0);
    expect(await LoginCode.countDocuments()).toBe(0);
  });

  it('rejects a malformed request with field details', async () => {
    const noName = await askForCode({ purpose: 'register', email: uniqueEmail() }).expect(400);
    expect(apiErrorSchema.safeParse(noName.body).success).toBe(true);
    expect(noName.body.error.details.map((d: { path: string }) => d.path)).toContain('body.name');

    await askForCode({ purpose: 'login', email: 'not-an-email' }).expect(400);
    await askForCode({ purpose: 'delete-everything', email: uniqueEmail() }).expect(400);
    await askForCode({}).expect(400);

    expect(mailbox.sent).toHaveLength(0);
  });

  it('replaces the waiting code, so only the newest one works', async () => {
    const email = uniqueEmail();

    await askForCode(signUpBody(email)).expect(202);
    const first = mailbox.codeFor(email);

    jumpForward((env.LOGIN_CODE_RESEND_SEC + 1) * 1000);
    await askForCode(signUpBody(email)).expect(202);
    const second = mailbox.codeFor(email);

    expect(await LoginCode.countDocuments({ email })).toBe(1);
    // (One time in a million the two are the same number, and the old one works.)
    if (first !== second) await enterCode(email, first).expect(401);
    await enterCode(email, second).expect(200);
  });

  describe('limits', () => {
    it('allows one code per address per cooldown, for any address', async () => {
      const known = await registerUser(app);
      const unknown = uniqueEmail();

      for (const email of [known.email, unknown]) {
        await askForCode(signInBody(email)).expect(202);
        const again = await askForCode(signInBody(email)).expect(429);
        expect(again.body.error.code).toBe('RATE_LIMITED');
      }

      // Not even the notice about a missing account is sent twice.
      expect(mailbox.to(known.email)).toHaveLength(1);
      expect(mailbox.to(unknown)).toHaveLength(1);
    });

    it('stops filling one inbox after a handful of emails', async () => {
      const email = uniqueEmail();

      // Each jump clears the one-a-minute cooldown, and all of them together stay
      // inside the 15-minute window the cap counts in.
      for (let sent = 0; sent < CODE_EMAILS_PER_ADDRESS_PER_15_MIN; sent += 1) {
        await askForCode(signInBody(email)).expect(202);
        jumpForward((env.LOGIN_CODE_RESEND_SEC + 1) * 1000);
      }

      const refused = await askForCode(signInBody(email)).expect(429);
      expect(refused.body.error.message).toMatch(/too many codes/i);
      expect(mailbox.to(email)).toHaveLength(CODE_EMAILS_PER_ADDRESS_PER_15_MIN);
    });

    it('stops one network from asking for codes for many addresses', async () => {
      for (let i = 0; i < env.RATE_LIMIT_CODE_REQUEST_PER_15_MIN; i += 1) {
        await askForCode(signUpBody(uniqueEmail())).expect(202);
      }

      await askForCode(signUpBody(uniqueEmail())).expect(429);
      expect(mailbox.sent).toHaveLength(env.RATE_LIMIT_CODE_REQUEST_PER_15_MIN);
    });

    it('answers 503 once the server has sent its daily allowance, and spends none on repeats', async () => {
      const original = env.EMAIL_DAILY_LIMIT;
      env.EMAIL_DAILY_LIMIT = 2;

      try {
        const first = uniqueEmail();
        await askForCode(signUpBody(first)).expect(202);
        await askForCode(signUpBody(uniqueEmail())).expect(202);

        // A repeat for the first address is refused by its own cooldown, before
        // it reaches the daily count.
        await askForCode(signUpBody(first)).expect(429);

        const blocked = await askForCode(signUpBody(uniqueEmail())).expect(503);
        expect(blocked.body.error.code).toBe('SERVICE_UNAVAILABLE');
        expect(blocked.body.error.message).toMatch(/busy right now/i);
        expect(mailbox.sent).toHaveLength(2);

        // Password sign-in is a different door and stays open.
        const user = await registerUser(app);
        await request(app)
          .post('/api/auth/login')
          .send({ email: user.email, password: VALID_PASSWORD })
          .expect(200);
      } finally {
        env.EMAIL_DAILY_LIMIT = original;
      }
    });

    it('does not spend the daily allowance on malformed requests', async () => {
      const original = env.EMAIL_DAILY_LIMIT;
      env.EMAIL_DAILY_LIMIT = 1;

      try {
        for (let i = 0; i < 3; i += 1) await askForCode({ purpose: 'login' }).expect(400);
        await askForCode(signUpBody(uniqueEmail())).expect(202);
      } finally {
        env.EMAIL_DAILY_LIMIT = original;
      }
    });
  });

  describe('when the email cannot be sent', () => {
    beforeEach(() => {
      mailbox.failWith = new EmailError('brevo', 'brevo returned HTTP 401: Key not found', 401);
    });

    it('answers 503 in words for the person, never the vendor message', async () => {
      const response = await askForCode(signUpBody(uniqueEmail())).expect(503);

      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(response.body.error.message).toMatch(/couldn't send the email/i);
      expect(JSON.stringify(response.body)).not.toMatch(/brevo|Key not found/i);
    });

    it('leaves no code behind, and lets them try again at once', async () => {
      const email = uniqueEmail();
      await askForCode(signUpBody(email)).expect(503);
      expect(await LoginCode.countDocuments({ email })).toBe(0);

      // A failed request did not use up the cooldown or the daily allowance.
      mailbox.failWith = null;
      await askForCode(signUpBody(email)).expect(202);
      expect(mailbox.to(email)).toHaveLength(1);
    });
  });
});

describe('POST /api/auth/code/verify', () => {
  it('creates the account for a sign-up and starts a session', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email, 'Grace Hopper')).expect(202);

    const response = await enterCode(email, mailbox.codeFor(email)).expect(200);

    expect(authResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.user).toMatchObject({
      name: 'Grace Hopper',
      email,
      role: 'member',
      authProvider: 'local',
    });

    const cookie = (response.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');

    const user = await User.findOne({ email }).select('+passwordHash');
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user?.passwordHash).toBeUndefined();

    // The token is a real one.
    await request(app).get('/api/auth/me').set('Authorization', bearer(response.body)).expect(200);
    expect(await LoginCode.countDocuments({ email })).toBe(0);
  });

  it('signs in to an account made earlier with a code, without creating another', async () => {
    const email = uniqueEmail();
    const first = await signUp(email);
    jumpForward((env.LOGIN_CODE_RESEND_SEC + 1) * 1000);

    await askForCode(signInBody(email)).expect(202);
    const response = await enterCode(email, mailbox.codeFor(email)).expect(200);

    expect(response.body.user.id).toBe(first.body.user.id);
    expect(await User.countDocuments({ email })).toBe(1);
  });

  it('ignores case, surrounding space and the space in "123 456"', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const code = mailbox.codeFor(email);

    await request(app)
      .post('/api/auth/code/verify')
      .send({ email: `  ${email.toUpperCase()} `, code: ` ${code.slice(0, 3)} ${code.slice(3)} ` })
      .expect(200);
  });

  it('rejects a wrong code the same way as no code, and counts the guess', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const wrong = mailbox.codeFor(email) === '000000' ? '111111' : '000000';

    const bad = await enterCode(email, wrong).expect(401);
    const none = await enterCode(uniqueEmail(), wrong).expect(401);

    expect(bad.body.error.message).toBe(none.body.error.message);
    expect((await LoginCode.findOne({ email }))?.attempts).toBe(1);
    // The right code still works after one slip.
    await enterCode(email, mailbox.codeFor(email)).expect(200);
  });

  it('stops accepting a code after too many wrong guesses, even the right one', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const right = mailbox.codeFor(email);
    const wrong = right === '000000' ? '111111' : '000000';

    for (let i = 0; i < env.LOGIN_CODE_MAX_ATTEMPTS; i += 1) {
      await enterCode(email, wrong).expect(401);
    }

    await enterCode(email, right).expect(401);
    expect(await User.countDocuments({ email })).toBe(0);
  });

  it('refuses a code at its attempt ceiling even before it has been cleaned up', async () => {
    // What a burst of parallel guesses leaves behind for a moment: the counter
    // at the ceiling, and the code not yet deleted by whichever request got
    // there last. Guesses that arrive in that gap must not be evaluated, or
    // "five tries" would be "five tries per request in flight".
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    await LoginCode.updateOne({ email }, { attempts: env.LOGIN_CODE_MAX_ATTEMPTS });

    await enterCode(email, mailbox.codeFor(email)).expect(401);
    expect(await User.countDocuments({ email })).toBe(0);
  });

  it('accepts the right code on the last allowed attempt', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const right = mailbox.codeFor(email);
    const wrong = right === '000000' ? '111111' : '000000';

    for (let i = 0; i < env.LOGIN_CODE_MAX_ATTEMPTS - 1; i += 1) {
      await enterCode(email, wrong).expect(401);
    }

    await enterCode(email, right).expect(200);
  });

  it('works once', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const code = mailbox.codeFor(email);

    await enterCode(email, code).expect(200);
    await enterCode(email, code).expect(401);
  });

  it('lets only one of two simultaneous requests with the right code through', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const code = mailbox.codeFor(email);

    const results = await Promise.all([enterCode(email, code), enterCode(email, code)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(await User.countDocuments({ email })).toBe(1);
  });

  it('refuses a code after it has expired', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const code = mailbox.codeFor(email);

    jumpForward((env.LOGIN_CODE_TTL_MIN * 60 + 1) * 1000);

    await enterCode(email, code).expect(401);
    expect(await User.countDocuments({ email })).toBe(0);
  });

  it('does not take a code meant for one address to another', async () => {
    const a = uniqueEmail();
    const b = uniqueEmail();
    await askForCode(signUpBody(a)).expect(202);
    await askForCode(signUpBody(b)).expect(202);

    await enterCode(b, mailbox.codeFor(a)).expect(401);
    expect(await User.countDocuments({ email: b })).toBe(0);
  });

  it('rejects a code that is not six digits before looking anything up', async () => {
    for (const code of ['12345', '1234567', 'abcdef', '']) {
      const response = await enterCode(uniqueEmail(), code).expect(400);
      expect(response.body.error.details.map((d: { path: string }) => d.path)).toContain(
        'body.code',
      );
    }
  });

  it('stops one caller trying code after code for an address', async () => {
    const email = uniqueEmail();

    for (let i = 0; i < 10; i += 1) await enterCode(email, '123456').expect(401);

    const refused = await enterCode(email, '123456').expect(429);
    expect(refused.body.error.message).toMatch(/too many incorrect codes/i);
  });

  it('refuses a sign-in code once the account has become a guest', async () => {
    const user = await registerUser(app);
    await askForCode(signInBody(user.email)).expect(202);
    await User.updateOne({ _id: user.id }, { authProvider: 'guest' });

    await enterCode(user.email, mailbox.codeFor(user.email)).expect(401);
  });

  it('refuses a sign-in code once the account has been deleted, and creates nothing', async () => {
    const user = await registerUser(app);
    await askForCode(signInBody(user.email)).expect(202);
    await User.deleteOne({ _id: user.id });

    await enterCode(user.email, mailbox.codeFor(user.email)).expect(401);
    expect(await User.countDocuments({ email: user.email })).toBe(0);
  });

  it('signs a sign-up code in to an account made in the meantime', async () => {
    const email = uniqueEmail();
    await askForCode(signUpBody(email)).expect(202);
    const code = mailbox.codeFor(email);

    // Somebody registers the address with a password while the email is in
    // flight. The code proves who owns it, so it is theirs.
    const racer = await registerUser(app, { email });
    const response = await enterCode(email, code).expect(200);

    expect(response.body.user.id).toBe(racer.id);
    expect(await User.countDocuments({ email })).toBe(1);
  });

  describe('an account made with a password and never verified', () => {
    it('is claimed by whoever proves the address: password and sessions are removed', async () => {
      // The attacker registers somebody else's address, with a password they
      // know, and is signed in.
      const squatter = await registerUser(app);

      // The owner of the address signs in with a code.
      await askForCode(signInBody(squatter.email)).expect(202);
      const response = await enterCode(squatter.email, mailbox.codeFor(squatter.email)).expect(200);

      // Same account, same data...
      expect(response.body.user.id).toBe(squatter.id);
      const user = await User.findById(squatter.id).select('+passwordHash +refreshTokens');
      expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
      // ...but nothing the squatter held works any more.
      expect(user?.passwordHash).toBeUndefined();
      expect(user?.refreshTokens).toHaveLength(1);

      await request(app)
        .post('/api/auth/login')
        .send({ email: squatter.email, password: squatter.password })
        .expect(401);
      await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', squatter.refreshCookie)
        .expect(401);
    });

    it('keeps its password once the address has been proven', async () => {
      // A verified account that has a password (one that predates this feature
      // and was claimed, then given another) is not claimed a second time.
      const user = await registerUser(app);
      await User.updateOne({ _id: user.id }, { emailVerifiedAt: new Date() });

      await askForCode(signInBody(user.email)).expect(202);
      await enterCode(user.email, mailbox.codeFor(user.email)).expect(200);

      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      await request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(200);
    });
  });
});

describe('password accounts and code accounts side by side', () => {
  it('rejects a password sign-in for an account that has no password', async () => {
    const email = uniqueEmail();
    await signUp(email);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: VALID_PASSWORD })
      .expect(401);

    // The same message as a wrong password: no hint that the account exists.
    expect(response.body.error.message).toBe('Invalid email or password');
  });

  it('refreshes and signs out like any other session', async () => {
    const { cookie } = await signUp(uniqueEmail());

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);
    expect(authResponseSchema.safeParse(refreshed.body).success).toBe(true);

    const next = extractRefreshCookie(refreshed.headers['set-cookie'] as unknown as string[]);
    await request(app).post('/api/auth/logout').set('Cookie', next).expect(204);
    await request(app).post('/api/auth/refresh').set('Cookie', next).expect(401);
  });
});
