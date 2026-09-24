import { logger } from '../logger.js';
import { ProviderError } from './types.js';

/** How long one vendor call may take. Transcribing an hour of audio is slow. */
export const PROVIDER_TIMEOUT_MS = 180_000;

/**
 * Waits before retrying a transient vendor error inside the same call.
 *
 * Free tiers answer "overloaded" (503) and "slow down" (429) routinely.
 * Retrying here costs one request; letting the error reach the job queue
 * costs a whole new attempt a backoff later, repeating work that had already
 * succeeded (a transcription before a failed summary).
 *
 * Only one retry: Gemini's free tier counts every request against a daily
 * allowance per model (20 at Phase 11), failed ones included, and an
 * overload measured then lasted minutes, not seconds. The next model in the
 * fallback chain is a better second try than a third request to this one;
 * the queue's own retries cover longer outages.
 */
const DEFAULT_RETRY_DELAYS_MS = [3_000];
let retryDelaysMs = DEFAULT_RETRY_DELAYS_MS;

/**
 * A vendor asking for a longer pause than this (Retry-After, or Gemini's
 * `retryDelay`) is out of quota for a while, not briefly busy: fail now and
 * let the queue's backoff wait instead of holding the worker.
 */
export const MAX_IN_CALL_WAIT_MS = 20_000;

/** Test seam: the pauses between in-call retries; `null` restores the default. */
export function setProviderRetryDelays(delays: number[] | null): void {
  retryDelaysMs = delays ?? DEFAULT_RETRY_DELAYS_MS;
}

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * The pause a vendor asked for, in ms: the Retry-After header, or the
 * `"retryDelay": "43s"` Google puts in a 429's error details.
 */
export function requestedDelayMs(headers: Headers, body: string): number | null {
  const header = headers.get('retry-after');
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Number(header) * 1000;

  const google = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return google ? Number(google[1]) * 1000 : null;
}

/**
 * Calls a vendor endpoint and returns the parsed JSON body.
 *
 * Errors carry the HTTP status and a trimmed slice of the response body -
 * which is where vendors explain what was wrong - but never the request, so
 * an API key in a header can never end up in a log line or a UI message.
 *
 * 429 and 5xx are retryable (rate limits and outages pass); other 4xx are not,
 * because a revoked key or a rejected file will fail the same way every time.
 * 429/5xx are first retried here, once and briefly (DEFAULT_RETRY_DELAYS_MS).
 */
export async function postJson(
  provider: string,
  url: string,
  init: { headers: Record<string, string>; body: string | FormData },
): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await postOnce(provider, url, init);
    if (outcome.ok) return outcome.body;

    const { error, waitMs } = outcome;
    const pause = waitMs ?? retryDelaysMs[attempt];
    const retry =
      error.status !== null &&
      TRANSIENT_STATUSES.has(error.status) &&
      attempt < retryDelaysMs.length &&
      pause !== undefined &&
      pause <= MAX_IN_CALL_WAIT_MS;
    if (!retry) throw error;

    logger.warn(
      { provider, status: error.status, attempt: attempt + 1, waitMs: pause },
      '[ai] transient provider error, retrying',
    );
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

type Outcome =
  { ok: true; body: unknown } | { ok: false; error: ProviderError; waitMs: number | null };

async function postOnce(
  provider: string,
  url: string,
  init: { headers: Record<string, string>; body: string | FormData },
): Promise<Outcome> {
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    // Not retried in the call: a timeout has already waited three minutes.
    const reason = error instanceof Error ? error.message : 'network error';
    throw new ProviderError(provider, `${provider} could not be reached: ${reason}`, null, true);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const detail = text.replace(/\s+/g, ' ').slice(0, 300);
    const retryable = response.status === 429 || response.status >= 500;
    return {
      ok: false,
      waitMs: requestedDelayMs(response.headers, text),
      error: new ProviderError(
        provider,
        `${provider} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
        response.status,
        retryable,
      ),
    };
  }

  try {
    return { ok: true, body: await response.json() };
  } catch {
    throw new ProviderError(
      provider,
      `${provider} returned a body that is not JSON`,
      response.status,
      true,
    );
  }
}
