import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  REFRESH_COOKIE_NAME,
  apiErrorSchema,
  authResponseSchema,
  type AuthResponse,
} from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { resetRateLimits } from '../../middleware/rateLimit.js';
import { DEMO_TEAM_SLUG } from '../demo/demo.constants.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Team } from '../teams/team.model.js';
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

/**
 * One account signed in from several places at once: a laptop and a phone, or
 * a seeded team-mate that several reviewers use for the second seat in a call.
 */
describe('session isolation between sign-ins of one account', () => {
  let shared: Awaited<ReturnType<typeof registerUser>>;

  /** Signs in again and returns the refresh cookie for that new session. */
  async function signIn(): Promise<string> {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: shared.email, password: shared.password })
      .expect(200);
    return extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]);
  }

  beforeEach(async () => {
    shared = await registerUser(app, { name: 'Ada Lovelace' });
  });

  it('treats two concurrent refreshes of the same token as a race, not theft', async () => {
    const session = await signIn();

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

  it('keeps one session signed in when another triggers reuse detection', async () => {
    const reviewerA = await signIn();
    const reviewerB = await signIn();

    // Reviewer A rotates, then replays the old token long after the window.
    const rotated = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', reviewerA)
      .expect(200);
    const reviewerACurrent = extractRefreshCookie(
      rotated.headers['set-cookie'] as unknown as string[],
    );

    await expireGraceWindow(shared.id);
    await request(app).post('/api/auth/refresh').set('Cookie', reviewerA).expect(401);

    // Reviewer A's own family is gone...
    await request(app).post('/api/auth/refresh').set('Cookie', reviewerACurrent).expect(401);

    // ...but reviewer B, on a different family, is untouched. This is the
    // whole point: one reviewer's mishap must not sign everyone else out.
    await request(app).post('/api/auth/refresh').set('Cookie', reviewerB).expect(200);
  });

  it('gives every sign-in its own token family', async () => {
    await signIn();
    await signIn();
    await signIn();

    const stored = await User.findById(shared.id).select('+refreshTokens');
    const tokens = stored?.refreshTokens ?? [];
    const families = new Set(tokens.map((token) => token.familyId));

    // Four sign-ins: the registration in beforeEach plus three logins.
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

/**
 * What `npm run seed` leaves behind, reduced to what the demo login needs:
 * the seeded persona, a real team-mate, the team, and one sample meeting.
 */
async function seedDemoWorkspace() {
  const persona = await registerUser(app, { name: 'Demo User', email: 'demo@intellmeet.app' });
  const ada = await registerUser(app, { name: 'Ada Lovelace' });

  const team = await Team.create({
    name: 'IntellMeet Demo Team',
    slug: DEMO_TEAM_SLUG,
    ownerId: persona.id,
    members: [
      { userId: persona.id, role: 'admin', joinedAt: new Date() },
      { userId: ada.id, role: 'admin', joinedAt: new Date() },
    ],
  });

  const sample = await Meeting.create({
    teamId: team._id,
    title: 'Sprint 14 planning',
    hostId: persona.id,
    roomCode: 'SEED234',
    status: 'ended',
    seeded: true,
  });

  return { persona, ada, team, sample };
}

/** "Try Live Demo": returns the guest's auth payload and refresh cookie. */
async function demoSignIn() {
  const response = await request(app).post('/api/auth/demo').expect(201);
  return {
    auth: response.body as AuthResponse,
    cookie: extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]),
  };
}

describe('POST /api/auth/demo', () => {
  it('reports the feature as unavailable when the demo workspace is not seeded', async () => {
    const response = await request(app).post('/api/auth/demo').expect(503);

    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).toContain('seed');
  });

  it('makes every sign-in a different guest, with a friendly name', async () => {
    await seedDemoWorkspace();

    const first = await demoSignIn();
    const second = await demoSignIn();

    expect(authResponseSchema.safeParse(first.auth).success).toBe(true);
    // The bug this replaces: every "Try Live Demo" used to be the same person.
    expect(first.auth.user.id).not.toBe(second.auth.user.id);
    expect(first.auth.user.name).not.toBe(second.auth.user.name);

    for (const { auth } of [first, second]) {
      expect(auth.user.authProvider).toBe('guest');
      expect(auth.user.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      // Never the seeded persona's identity.
      expect(auth.user.email).not.toBe('demo@intellmeet.app');
      expect(auth.user.email).toMatch(/@guest\.intellmeet\.invalid$/);
    }
  });

  it('puts the guest in the seeded team as a plain member, where the samples are', async () => {
    const { team, sample } = await seedDemoWorkspace();
    const { auth } = await demoSignIn();
    const guest = { accessToken: auth.accessToken };

    const teams = await request(app).get('/api/teams').set('Authorization', bearer(guest));
    expect(teams.body.teams).toHaveLength(1);
    expect(teams.body.teams[0].id).toBe(team._id.toString());
    // Not an admin: a guest cannot remove the seeded team-mates or promote itself.
    expect(teams.body.teams[0].myRole).toBe('member');

    const meetings = await request(app).get('/api/meetings').set('Authorization', bearer(guest));
    expect(meetings.body.meetings.map((m: { id: string }) => m.id)).toContain(
      sample._id.toString(),
    );
  });

  it('does not make one guest the host of another guest’s meeting', async () => {
    const { team } = await seedDemoWorkspace();
    const alice = await demoSignIn();
    const bob = await demoSignIn();

    const created = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(alice.auth))
      .send({ teamId: team._id.toString(), title: 'Two reviewers' })
      .expect(201);
    const meetingId = created.body.meeting.id as string;

    const asBob = await request(app)
      .get(`/api/meetings/${meetingId}`)
      .set('Authorization', bearer(bob.auth))
      .expect(200);
    expect(asBob.body.meeting.isHost).toBe(false);

    // The "End for all" that one reviewer could once press on the other.
    await request(app)
      .post(`/api/meetings/${meetingId}/end`)
      .set('Authorization', bearer(bob.auth))
      .expect(403);
  });

  it('avoids giving two guests in the team a name that shares a word', async () => {
    await seedDemoWorkspace();

    const names: string[] = [];
    for (let i = 0; i < 6; i += 1) names.push((await demoSignIn()).auth.user.name);

    const words = names.flatMap((name) => name.split(' '));
    expect(new Set(words).size).toBe(words.length);
  });

  it('creates a guest that cannot be signed into with a password', async () => {
    await seedDemoWorkspace();
    const { auth } = await demoSignIn();

    await request(app)
      .post('/api/auth/login')
      .send({ email: auth.user.email, password: VALID_PASSWORD })
      .expect(401);
  });

  it('refuses new guests once the ceiling is reached', async () => {
    await seedDemoWorkspace();
    const ceiling = env.DEMO_MAX_GUESTS;
    env.DEMO_MAX_GUESTS = 2;

    try {
      await demoSignIn();
      await demoSignIn();

      const refused = await request(app).post('/api/auth/demo').expect(503);
      expect(refused.body.error.message).toMatch(/busy/i);
      expect(await User.countDocuments({ authProvider: 'guest' })).toBe(2);
    } finally {
      env.DEMO_MAX_GUESTS = ceiling;
    }
  });
});

describe('DELETE /api/auth/demo', () => {
  it('deletes the guest, the meetings it hosted and its team membership', async () => {
    const { team, sample } = await seedDemoWorkspace();
    const { auth, cookie } = await demoSignIn();

    const created = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(auth))
      .send({ teamId: team._id.toString(), title: 'Guest meeting' })
      .expect(201);

    const response = await request(app)
      .delete('/api/auth/demo')
      .set('Authorization', bearer(auth))
      .set('Cookie', cookie)
      .expect(204);

    expect(await User.exists({ _id: auth.user.id })).toBeNull();
    expect(await Meeting.exists({ _id: created.body.meeting.id })).toBeNull();
    const after = await Team.findById(team._id);
    expect(after?.members.map((m) => m.userId.toString())).not.toContain(auth.user.id);

    // The shared samples are untouched.
    expect(await Meeting.exists({ _id: sample._id })).not.toBeNull();

    // The session is over: the cookie is cleared and could not refresh anyway.
    const cleared = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cleared).toMatch(new RegExp(`^${REFRESH_COOKIE_NAME}=;`));
    await request(app).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('refuses to delete a real account', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .delete('/api/auth/demo')
      .set('Authorization', bearer(user))
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(await User.exists({ _id: user.id })).not.toBeNull();
  });

  it('requires authentication', async () => {
    await request(app).delete('/api/auth/demo').expect(401);
  });
});
