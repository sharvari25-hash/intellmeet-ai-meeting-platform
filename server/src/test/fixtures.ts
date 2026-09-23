import type { Express } from 'express';
import request from 'supertest';
import { REFRESH_COOKIE_NAME, type AuthResponse } from '@intellmeet/shared';

/**
 * Test helpers for building authenticated state.
 *
 * Every helper goes through the real HTTP surface rather than reaching into
 * the database, so the tests exercise validation, hashing, token issuance and
 * cookie handling exactly as a browser would. Inserting a user directly would
 * test the assertions and nothing else.
 */

let counter = 0;

/**
 * A unique email per call.
 *
 * Unique addresses matter beyond hygiene: the login rate limiter is keyed on
 * IP **and** email, and every Supertest request comes from 127.0.0.1. Reusing
 * an address across tests would make them share a rate-limit bucket and fail
 * in whatever order happened to exhaust it first.
 */
export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export const VALID_PASSWORD = 'CorrectHorse123';

export interface TestUser {
  id: string;
  name: string;
  email: string;
  password: string;
  accessToken: string;
  /** Raw `Set-Cookie` value, ready to pass straight back via `.set('Cookie', …)`. */
  refreshCookie: string;
  auth: AuthResponse;
}

/** Pulls the refresh cookie out of a `Set-Cookie` header list. */
export function extractRefreshCookie(setCookie: string[] | undefined): string {
  const header = (setCookie ?? []).find((cookie) => cookie.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!header) throw new Error('No refresh cookie was set on the response');
  // Keep only the `name=value` pair; attributes are not sent back by a client.
  return header.split(';')[0] as string;
}

/** Registers a fresh user through the API and returns their credentials. */
export async function registerUser(
  app: Express,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<TestUser> {
  const name = overrides.name ?? 'Test User';
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? VALID_PASSWORD;

  const response = await request(app)
    .post('/api/auth/register')
    .send({ name, email, password })
    .expect(201);

  const auth = response.body as AuthResponse;

  return {
    id: auth.user.id,
    name,
    email,
    password,
    accessToken: auth.accessToken,
    refreshCookie: extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]),
    auth,
  };
}

/** `Authorization` header for a registered test user. */
export function bearer(user: Pick<TestUser, 'accessToken'>): string {
  return `Bearer ${user.accessToken}`;
}

/** Creates a team owned by `user` and returns its id. */
export async function createTeam(
  app: Express,
  user: TestUser,
  name = 'Test Team',
): Promise<string> {
  const response = await request(app)
    .post('/api/teams')
    .set('Authorization', bearer(user))
    .send({ name })
    .expect(201);

  return response.body.team.id as string;
}

/** Mints an invite code for a team the user administers. */
export async function createInvite(app: Express, user: TestUser, teamId: string): Promise<string> {
  const response = await request(app)
    .post(`/api/teams/${teamId}/invites`)
    .set('Authorization', bearer(user))
    .expect(201);

  return response.body.invite.code as string;
}
