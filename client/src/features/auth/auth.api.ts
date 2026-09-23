import { z } from 'zod';
import {
  authResponseSchema,
  publicUserSchema,
  type AuthResponse,
  type LoginInput,
  type RegisterInput,
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

/** Signs in as the shared, pre-seeded demo account. No credentials needed. */
export function demoLogin(): Promise<AuthResponse> {
  return api('/auth/demo', authResponseSchema, { method: 'POST', ...noRetry });
}

export function logout(): Promise<void> {
  return apiVoid('/auth/logout', { method: 'POST', ...noRetry });
}

export const meResponseSchema = z.object({ user: publicUserSchema });

export function fetchMe() {
  return api('/auth/me', meResponseSchema).then((result) => result.user);
}
