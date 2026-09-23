import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { authPayload, apiErrorBody } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { ApiError, api, refreshSession } from './apiClient';

const payloadSchema = z.object({ ok: z.boolean() });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Signs in without going through a form, so the token is present. */
function signIn(token = 'token-1'): void {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: token,
  });
}

describe('apiClient', () => {
  it('sends the access token as a bearer header', async () => {
    signIn();
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/teams', payloadSchema);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/teams',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
      }),
    );
  });

  it('validates the response against the shared schema', async () => {
    signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ nope: 1 })),
    );

    await expect(api('/teams', payloadSchema)).rejects.toThrow();
  });

  it('throws an ApiError carrying the server code', async () => {
    signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(apiErrorBody('NOT_FOUND', 'Team not found'), 404)),
    );

    const error = await api('/teams/abc', payloadSchema).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).requestId).toBe('test-request');
  });

  it('refreshes once and retries the request after a 401', async () => {
    signIn('expired');

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === '/api/auth/refresh') return json(authPayload({ accessToken: 'fresh' }));
        // Unauthorised the first time, fine once the new token is attached.
        return calls.filter((call) => call === '/api/teams').length === 1
          ? json(apiErrorBody('UNAUTHORIZED', 'Token expired'), 401)
          : json({ ok: true });
      }),
    );

    await expect(api('/teams', payloadSchema)).resolves.toEqual({ ok: true });

    expect(calls).toEqual(['/api/teams', '/api/auth/refresh', '/api/teams']);
    expect(useAuthStore.getState().accessToken).toBe('fresh');
  });

  it('funnels concurrent 401s into a single refresh', async () => {
    signIn('expired');

    let refreshes = 0;
    const seen = new Map<string, number>();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/refresh') {
          refreshes += 1;
          // A real refresh is a round trip; the delay is what makes the race
          // this test is about actually happen.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return json(authPayload({ accessToken: 'fresh' }));
        }

        const count = (seen.get(url) ?? 0) + 1;
        seen.set(url, count);
        return count === 1
          ? json(apiErrorBody('UNAUTHORIZED', 'Token expired'), 401)
          : json({ ok: true });
      }),
    );

    // Four queries firing at once is exactly what a dashboard does on mount.
    await Promise.all([
      api('/teams', payloadSchema),
      api('/meetings', payloadSchema),
      api('/notifications', payloadSchema),
      api('/users/me', payloadSchema),
    ]);

    // Without the single-flight queue this would be four rotations, and three
    // of them would look to the server like a replayed refresh token.
    expect(refreshes).toBe(1);
  });

  it('clears the session when the refresh cookie is gone', async () => {
    signIn('expired');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/auth/refresh'
          ? json(apiErrorBody('UNAUTHORIZED', 'No active session'), 401)
          : json(apiErrorBody('UNAUTHORIZED', 'Token expired'), 401),
      ),
    );

    await expect(api('/teams', payloadSchema)).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('does not retry a request that opted out', async () => {
    signIn('expired');
    const fetchMock = vi.fn(async () => json(apiErrorBody('UNAUTHORIZED', 'Bad password'), 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api('/auth/login', payloadSchema, { method: 'POST', skipAuthRetry: true }),
    ).rejects.toBeInstanceOf(ApiError);

    // One call: no refresh, no retry. A wrong password must not look like an
    // expired token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('restores a session from the refresh cookie alone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(authPayload({ accessToken: 'restored' }))),
    );

    await expect(refreshSession()).resolves.toBe('restored');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.email).toBe('ada@example.com');
  });
});

describe('apiClient resilience', () => {
  it('resolves rather than rejects when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    // The startup bootstrap calls this without a catch. A rejection here would
    // strand the store on 'bootstrapping' and spin every protected route.
    await expect(refreshSession()).resolves.toBeNull();
    expect(useAuthStore.getState().status).toBe('anonymous');
  });
});
