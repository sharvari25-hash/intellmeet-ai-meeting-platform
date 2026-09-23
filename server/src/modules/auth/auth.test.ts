import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { REFRESH_COOKIE_NAME, apiErrorSchema, authResponseSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
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

  it('rejects the previous token once it has been rotated', async () => {
    const user = await registerUser(app);

    await request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(200);

    // Replaying the original cookie is exactly the reuse signal.
    await request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie).expect(401);
  });

  it('revokes every session when a rotated token is reused', async () => {
    const user = await registerUser(app);

    const rotatedResponse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(200);

    const currentCookie = extractRefreshCookie(
      rotatedResponse.headers['set-cookie'] as unknown as string[],
    );

    // An attacker replays the stolen (already-rotated) token.
    const reuse = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie)
      .expect(401);

    expect(reuse.body.error.message).toContain('revoked');

    // The legitimate client's still-valid token must now be dead too: we
    // cannot tell which party was the thief, so both are logged out.
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
