import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { REFRESH_COOKIE_NAME, apiErrorSchema, authResponseSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { resetRateLimits } from '../../middleware/rateLimit.js';
import { User } from '../users/user.model.js';
import {
  VALID_PASSWORD,
  bearer,
  extractRefreshCookie,
  registerUser,
  uniqueEmail,
} from '../../test/fixtures.js';
import { hashRefreshToken } from './auth.tokens.js';

const app = createApp();

/**
 * Backdates every revocation on a user so the reuse grace window has elapsed.
 *
 * Tests run with the real grace window enabled, because that is what
 * production does. Making a replay look "old" is how a test distinguishes a
 * genuine theft replay from the concurrent-tab race the window exists for,
 * without sleeping for ten seconds.
 */
async function expireGraceWindow(userId: string): Promise<void> {
  const longAgo = new Date(Date.now() - 60 * 60 * 1000);
  await User.updateOne(
    { _id: userId },
    { $set: { 'refreshTokens.$[token].revokedAt': longAgo } },
    { arrayFilters: [{ 'token.revokedAt': { $exists: true } }] },
  );
}

describe('POST /api/auth/register', () => {
  it('creates an account, returns the contract shape and sets a refresh cookie', async () => {
    const email = uniqueEmail();

    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada Lovelace', email, password: VALID_PASSWORD })
      .expect(201);

    expect(authResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.user.email).toBe(email);
    expect(response.body.user.role).toBe('member');
    expect(response.body.accessToken).toBeTruthy();

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    expect(refresh).toBeDefined();
    // The long-lived credential must be unreadable by JavaScript and scoped
    // to the auth routes.
    expect(refresh).toContain('HttpOnly');
    expect(refresh).toContain('Path=/api/auth');
    expect(refresh).toContain('SameSite=Lax');
  });

  it('never returns the password hash or the refresh token in the body', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('refreshToken');
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('stores a bcrypt hash, never the plaintext password', async () => {
    const email = uniqueEmail();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email, password: VALID_PASSWORD })
      .expect(201);

    const user = await User.findOne({ email }).select('+passwordHash');
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user?.passwordHash).not.toContain(VALID_PASSWORD);
  });

  it('rejects a weak password with field-level details', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: uniqueEmail(), password: 'short' })
      .expect(400);

    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details.map((d: { path: string }) => d.path)).toContain(
      'body.password',
    );
  });

  it('normalises the email, so casing cannot create a duplicate account', async () => {
    const email = uniqueEmail();

    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: `  ${email.toUpperCase()}  `, password: VALID_PASSWORD })
      .expect(201);

    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Imposter', email, password: VALID_PASSWORD })
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/auth/login', () => {
  it('authenticates with correct credentials', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    expect(authResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.user.id).toBe(user.id);
  });

  it('rejects a wrong password', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPassword123' })
      .expect(401);

    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('gives an identical message for a wrong password and an unknown account', async () => {
    const user = await registerUser(app);

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: 'WrongPassword123' })
      .expect(401);

    const unknownAccount = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(401);

    // Distinguishable messages would let an attacker enumerate which email
    // addresses have accounts.
    expect(unknownAccount.body.error.message).toBe(wrongPassword.body.error.message);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);

    expect(authResponseSchema.safeParse(response.body).success).toBe(true);

    const rotated = extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]);
    expect(rotated).not.toBe(user.refreshCookie);
  });

  it('rejects a rotated token once the grace window has passed', async () => {
    const user = await registerUser(app);

    await request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(200);
    await expireGraceWindow(user.id);

    // Replaying the original cookie is exactly the reuse signal.
    await request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });

  it('revokes the affected family when a rotated token is reused', async () => {
    const user = await registerUser(app);

    const rotatedResponse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);

    const currentCookie = extractRefreshCookie(
      rotatedResponse.headers['set-cookie'] as unknown as string[],
    );

    await expireGraceWindow(user.id);

    // An attacker replays the stolen (already-rotated) token.
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(401);

    expect(reuse.body.error.message).toContain('revoked');

    // The legitimate client's token from the same sign-in must be dead too:
    // we cannot tell which party was the thief, so that whole family goes.
    await request(app).post('/api/auth/refresh').set('Cookie', currentCookie).expect(401);

    const stored = await User.findById(user.id).select('+refreshTokens');
    expect(stored?.refreshTokens).toHaveLength(0);
  });

  it('clears the cookie when refresh fails', async () => {
    const response = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=not-a-real-token`)
      .expect(401);

    const cleared = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    // An empty value with an immediate expiry is how a cookie is deleted.
    expect(cleared).toMatch(new RegExp(`^${REFRESH_COOKIE_NAME}=;`));
  });

  it('returns 401 when no cookie is present at all', async () => {
    const response = await request(app).post('/api/auth/refresh').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('stores only a hash of the refresh token, never the token itself', async () => {
    const user = await registerUser(app);
    const rawToken = user.refreshCookie.split('=')[1] as string;

    const stored = await User.findById(user.id).select('+refreshTokens');
    const hashes = stored?.refreshTokens.map((token) => token.hash) ?? [];

    expect(hashes).toContain(hashRefreshToken(rawToken));
    expect(hashes).not.toContain(rawToken);
  });
});

describe('session isolation on the shared demo account', () => {
  let demoUserId: string;

  /** Signs in via /demo and returns the refresh cookie for that session. */
  async function demoSession(): Promise<string> {
    const response = await request(app).post('/api/auth/demo').expect(200);
    return extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]);
  }

  beforeEach(async () => {
    const demo = await registerUser(app, { name: 'Demo User', email: 'demo@intellmeet.app' });
    demoUserId = demo.id;
  });

  it('treats two concurrent refreshes of the same token as a race, not theft', async () => {
    const session = await demoSession();

    // Two tabs, each its own JavaScript context, refresh with the same cookie
    // at the same moment. Neither is an attack.
    const [first, second] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', session),
      request(app).post('/api/auth/refresh').set('Cookie', session),
    ]);

    expect([first.status, second.status]).toEqual([200, 200]);

    // Both tabs end up with usable, distinct tokens.
    const firstCookie = extractRefreshCookie(first.headers['set-cookie'] as unknown as string[]);
    const secondCookie = extractRefreshCookie(second.headers['set-cookie'] as unknown as string[]);
    expect(firstCookie).not.toBe(secondCookie);

    await request(app).post('/api/auth/refresh').set('Cookie', firstCookie).expect(200);
    await request(app).post('/api/auth/refresh').set('Cookie', secondCookie).expect(200);
  });

  it('keeps one reviewer signed in when another reviewer triggers reuse detection', async () => {
    const reviewerA = await demoSession();
    const reviewerB = await demoSession();

    // Reviewer A rotates, then replays the old token long after the window.
    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', reviewerA)
      .expect(200);
    const reviewerACurrent = extractRefreshCookie(
      rotated.headers['set-cookie'] as unknown as string[],
    );

    await expireGraceWindow(demoUserId);
    await request(app).post('/api/auth/refresh').set('Cookie', reviewerA).expect(401);

    // Reviewer A's own family is gone...
    await request(app).post('/api/auth/refresh').set('Cookie', reviewerACurrent).expect(401);

    // ...but reviewer B, on a different family, is untouched. This is the
    // whole point: one reviewer's mishap must not sign everyone else out.
    await request(app).post('/api/auth/refresh').set('Cookie', reviewerB).expect(200);
  });

  it('gives every /demo sign-in its own token family', async () => {
    await demoSession();
    await demoSession();
    await demoSession();

    const stored = await User.findById(demoUserId).select('+refreshTokens');
    const tokens = stored?.refreshTokens ?? [];
    const families = new Set(tokens.map((token) => token.familyId));

    // Four sign-ins: the registration in beforeEach plus three /demo calls.
    // Nothing has rotated yet, so one token per family is exactly right.
    expect(tokens).toHaveLength(4);
    expect(families.size).toBe(4);
  });
});

describe('stored session cap', () => {
  it('keeps at most MAX_SESSIONS_PER_USER tokens, pruning the oldest', async () => {
    const user = await registerUser(app);
    const cap = env.MAX_SESSIONS_PER_USER;

    // Sign in more times than the cap allows. Sequentially, so `createdAt`
    // strictly increases and "oldest" is unambiguous.
    for (let i = 0; i < cap + 5; i += 1) {
      // The login limiter allows 5 attempts per 15 minutes; this test is about
      // the session cap, so the counter is cleared between sign-ins rather
      // than weakening the limit that another test asserts.
      resetRateLimits();

      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
    }

    const stored = await User.findById(user.id).select('+refreshTokens');
    const tokens = stored?.refreshTokens ?? [];

    expect(tokens.length).toBeLessThanOrEqual(cap);

    // What survived must be the newest: the array is kept sorted by createdAt.
    const timestamps = tokens.map((token) => token.createdAt.getTime());
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it('drops expired tokens before spending the cap on them', async () => {
    const user = await registerUser(app);

    await User.updateOne(
      { _id: user.id },
      { $set: { 'refreshTokens.$[].expiresAt': new Date(Date.now() - 1000) } },
    );

    await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const stored = await User.findById(user.id).select('+refreshTokens');
    // The expired entry is gone; only the new session remains.
    expect(stored?.refreshTokens).toHaveLength(1);
  });
});

describe('POST /api/auth/logout', () => {
  it('invalidates the session and clears the cookie', async () => {
    const user = await registerUser(app);

    await request(app).post('/api/auth/logout').set('Cookie', user.refreshCookie).expect(204);

    await request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });

  it('is idempotent, so a second logout still succeeds', async () => {
    const user = await registerUser(app);

    await request(app).post('/api/auth/logout').set('Cookie', user.refreshCookie).expect(204);
    await request(app).post('/api/auth/logout').set('Cookie', user.refreshCookie).expect(204);
    await request(app).post('/api/auth/logout').expect(204);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the caller with a valid access token', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(response.body.user.id).toBe(user.id);
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a missing, malformed or invalid token', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Basic abc123').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    // A token forged with a different key must not be accepted, which is the
    // whole point of verifying rather than merely decoding.
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2NTdmMWY3N2JjZjg2Y2Q3OTk0MzkwMTEiLCJyb2xlIjoiYWRtaW4ifQ.bm90LWEtdmFsaWQtc2lnbmF0dXJl';

    await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('does not accept the refresh cookie as authentication', async () => {
    const user = await registerUser(app);

    // The access token is Bearer-only by design: nothing the browser attaches
    // automatically can authenticate a protected route, so CSRF cannot reach it.
    await request(app).get('/api/auth/me').set('Cookie', user.refreshCookie).expect(401);
  });
});

describe('login rate limiting', () => {
  it('blocks the sixth failed attempt for the same IP and email', async () => {
    const user = await registerUser(app);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: user.email, password: 'WrongPassword123' })
        .expect(401);
    }

    const blocked = await request(app)
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(429);

    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(apiErrorSchema.safeParse(blocked.body).success).toBe(true);
  });

  it('does not lock out a different account from the same IP', async () => {
    const victim = await registerUser(app);
    const bystander = await registerUser(app);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: victim.email, password: 'WrongPassword123' });
    }

    // Keying on IP alone would make one user's failures everyone's problem.
    await request(app)
      .post('/api/auth/login')
      .send({ email: bystander.email, password: bystander.password })
      .expect(200);
  });
});

describe('POST /api/auth/demo', () => {
  it('reports the feature as unavailable when the demo user is not seeded', async () => {
    const response = await request(app).post('/api/auth/demo').expect(503);

    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).toContain('seed');
  });

  it('signs in as the demo account without any credentials once seeded', async () => {
    await registerUser(app, { name: 'Demo User', email: 'demo@intellmeet.app' });

    const response = await request(app).post('/api/auth/demo').expect(200);

    expect(authResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.user.email).toBe('demo@intellmeet.app');
  });
});
