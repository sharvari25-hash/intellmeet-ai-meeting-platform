import { ProviderError } from './types.js';

/** How long one vendor call may take. Transcribing an hour of audio is slow. */
export const PROVIDER_TIMEOUT_MS = 180_000;

/**
 * Calls a vendor endpoint and returns the parsed JSON body.
 *
 * Errors carry the HTTP status and a trimmed slice of the response body -
 * which is where vendors explain what was wrong - but never the request, so
 * an API key in a header can never end up in a log line or a UI message.
 *
 * 429 and 5xx are retryable (rate limits and outages pass); other 4xx are not,
 * because a revoked key or a rejected file will fail the same way every time.
 */
export async function postJson(
  provider: string,
  url: string,
  init: { headers: Record<string, string>; body: string | FormData },
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'network error';
    throw new ProviderError(provider, `${provider} could not be reached: ${reason}`, null, true);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    const retryable = response.status === 429 || response.status >= 500;
    throw new ProviderError(
      provider,
      `${provider} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      response.status,
      retryable,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ProviderError(
      provider,
      `${provider} returned a body that is not JSON`,
      response.status,
      true,
    );
  }
}
