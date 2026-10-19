import { z } from 'zod';
import {
  authResponseSchema,
  loginCodeSentSchema,
  publicUserSchema,
  type AuthResponse,
  type LoginCodeSent,
  type LoginInput,
  type RegisterInput,
  type RequestLoginCodeInput,
  type VerifyLoginCodeInput,
} from '@intellmeet/shared';
import { api, apiVoid } from '@/lib/apiClient';

/**
 * `skipAuthRetry` on every call here is deliberate.
 *
 * A 401 from `/login` means the password was wrong, not that a token expired,
 * so silently refreshing and retrying would hide the real failure behind a
 * second confusing one.
 */
const noRetry = { skipAuthRetry: true } as const;

export function login(input: LoginInput): Promise<AuthResponse> {
  return api('/auth/login', authResponseSchema, { method: 'POST', body: input, ...noRetry });
}

export function register(input: RegisterInput): Promise<AuthResponse> {
  return api('/auth/register', authResponseSchema, { method: 'POST', body: input, ...noRetry });
}

/**
 * Asks for a sign-in code by email, to sign in or to sign up.
 *
 * The answer is the same for every address: it says when the code expires and
 * when another may be asked for, never whether the address has an account. What
 * differs is the email, which tells an address with no account (or one that
 * already has an account) what to do instead.
 */
export function requestLoginCode(input: RequestLoginCodeInput): Promise<LoginCodeSent> {
  return api('/auth/code', loginCodeSentSchema, { method: 'POST', body: input, ...noRetry });
}

/** Spends the code from the email, creating the account first for a sign-up. */
export function verifyLoginCode(input: VerifyLoginCodeInput): Promise<AuthResponse> {
  return api('/auth/code/verify', authResponseSchema, {
    method: 'POST',
    body: input,
    ...noRetry,
  });
}

/**
 * "Try Live Demo": creates a guest account of its own in the seeded demo team
 * and signs in as it. No credentials needed; every call is a new person.
 */
export function demoLogin(): Promise<AuthResponse> {
  return api('/auth/demo', authResponseSchema, { method: 'POST', ...noRetry });
}

/**
 * Ends a guest's demo session for good: the server deletes the guest with the
 * meetings it hosted and the teams it created. Real accounts get a 403.
 *
 * Unlike the other auth calls this one may refresh and retry, because it is
 * authenticated by the access token rather than by credentials in the body.
 */
export function endDemoSession(): Promise<void> {
  return apiVoid('/auth/demo', { method: 'DELETE' });
}

export function logout(): Promise<void> {
  return apiVoid('/auth/logout', { method: 'POST', ...noRetry });
}

export const meResponseSchema = z.object({ user: publicUserSchema });

export function fetchMe() {
  return api('/auth/me', meResponseSchema).then((result) => result.user);
}
