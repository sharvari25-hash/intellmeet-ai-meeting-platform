import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IN_CALL_WAIT_MS, postJson, requestedDelayMs, setProviderRetryDelays } from './http.js';
import { ProviderError } from './types.js';

/**
 * The in-call retry for transient vendor errors. No network: `fetch` is
 * stubbed, and the pauses are zero so the suite does not wait.
 */

const ok = () => new Response(JSON.stringify({ fine: true }), { status: 200 });
const status = (code: number, body = '', headers: Record<string, string> = {}) =>
  new Response(body, { status: code, headers });

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const call = () =>
  postJson('gemini', 'https://vendor.example/generate', { headers: {}, body: '{}' });

beforeEach(() => setProviderRetryDelays([0, 0]));
afterEach(() => {
  setProviderRetryDelays(null);
  vi.unstubAllGlobals();
});

describe('postJson', () => {
  it('rides out a brief overload: 503, then 503, then the answer', async () => {
    const fetchMock = stubFetch(status(503), status(503), ok());

    await expect(call()).resolves.toEqual({ fine: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the last pause and leaves the error retryable for the queue', async () => {
    const fetchMock = stubFetch(status(503), status(503), status(503, 'still busy'));

    const error = (await call().catch((caught: unknown) => caught)) as ProviderError;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(503);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('still busy');
  });

  it('never repeats a request that will fail the same way (400, 401, 403)', async () => {
    for (const code of [400, 401, 403]) {
      const fetchMock = stubFetch(status(code));
      const error = (await call().catch((caught: unknown) => caught)) as ProviderError;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(error.retryable).toBe(false);
    }
  });

  it('honours a short pause the vendor asks for', async () => {
    const fetchMock = stubFetch(status(429, 'slow down', { 'retry-after': '0' }), ok());

    await expect(call()).resolves.toEqual({ fine: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails at once when the vendor asks for a long pause: out of quota, not busy', async () => {
    const fetchMock = stubFetch(
      status(429, `{"error":{"details":[{"retryDelay":"${MAX_IN_CALL_WAIT_MS / 1000 + 1}s"}]}}`),
      ok(),
    );

    const error = (await call().catch((caught: unknown) => caught)) as ProviderError;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.status).toBe(429);
    expect(error.retryable).toBe(true);
  });
});

describe('requestedDelayMs', () => {
  it('reads Retry-After seconds and Google’s retryDelay', () => {
    expect(requestedDelayMs(new Headers({ 'retry-after': '7' }), '')).toBe(7000);
    expect(requestedDelayMs(new Headers(), '"retryDelay": "12.5s"')).toBe(12_500);
    expect(requestedDelayMs(new Headers(), 'no hint')).toBeNull();
  });
});
