import {
  authResponseSchema,
  apiErrorSchema,
  type ErrorCode,
  type FieldIssue,
} from '@intellmeet/shared';
import type { ZodType } from 'zod';
import { useAuthStore } from '@/stores/authStore';

/**
 * A failed API call, carrying the server's stable error vocabulary.
 *
 * Callers switch on `code` rather than on `message`: the codes are part of the
 * contract in `shared/src/errors.ts`, while messages get reworded. `requestId`
 * matches the `X-Request-Id` header and the server log line for that request,
 * so a user-reported failure is one grep away.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: FieldIssue[];
  readonly requestId?: string;

  constructor(
    status: number,
    error: { code: ErrorCode; message: string; details?: FieldIssue[]; requestId?: string },
  ) {
    super(error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Suppresses the refresh-and-retry dance.
   *
   * The auth endpoints need it: a 401 from `/login` means "wrong password",
   * not "expired token", and refreshing in response would be both pointless
   * and confusing. `/refresh` itself needs it to avoid recursion.
   */
  skipAuthRetry?: boolean;
}

/**
 * Every call goes to a same-origin `/api` path.
 *
 * In dev Vite proxies it to localhost:5000; in production `vercel.json`
 * rewrites it to the Render service. Because the browser only ever sees its
 * own origin, the refresh cookie stays first-party - which is the whole reason
 * for the rewrite, and why there is no API base URL anywhere in the client.
 */
const API_PREFIX = '/api';

function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(`${API_PREFIX}${path}`, {
    method: options.method ?? 'GET',
    headers,
    // Same-origin already implies cookies are sent, but saying so keeps the
    // refresh cookie's role explicit for anyone reading this in isolation.
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

// ---------------------------------------------------------------------------
// Single-flight refresh
// ---------------------------------------------------------------------------

/**
 * The in-progress refresh, if any.
 *
 * A page that mounts four queries at once will get four simultaneous 401s the
 * moment the access token expires. Without this, all four would POST
 * /api/auth/refresh with the same cookie; rotation means the first wins and
 * the rest look exactly like a stolen token being replayed. Funnelling them
 * into one promise means one rotation and three awaits.
 *
 * (The server also tolerates a genuine race inside a short grace window,
 * because two browser *tabs* are separate JavaScript contexts and this queue
 * cannot span them. Belt and braces, at different layers.)
 */
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  try {
    const response = await send('/auth/refresh', { method: 'POST', skipAuthRetry: true }, null);

    if (!response.ok) {
      // The cookie is expired, revoked or absent. The server has already
      // cleared it, so there is nothing to retry with.
      useAuthStore.getState().clearSession();
      return null;
    }

    const result = authResponseSchema.parse(await response.json());
    useAuthStore.getState().setSession(result.user, result.accessToken);
    return result.accessToken;
  } catch {
    // A dropped connection, a DNS failure or a body that does not match the
    // contract. This must resolve rather than reject: the startup bootstrap
    // fires it without a catch, and a rejection there would leave the store
    // stuck on `bootstrapping` - every protected route spinning forever
    // because the API was briefly unreachable.
    useAuthStore.getState().clearSession();
    return null;
  }
}

/**
 * Exchanges the refresh cookie for a fresh access token.
 *
 * Also used at startup to restore a session after a hard reload, which is the
 * only reason a signed-in user survives closing the tab: the access token was
 * only ever in memory.
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const parsed = apiErrorSchema.parse(await response.json());
    return new ApiError(response.status, parsed.error);
  } catch {
    // A proxy timeout or an HTML error page never matches the contract.
    // Surfacing it as a generic ApiError keeps every caller on one code path.
    return new ApiError(response.status, {
      code: response.status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
      message: `The server responded ${response.status}.`,
    });
  }
}

/**
 * Performs a request, refreshing once and retrying if the token had expired.
 *
 * Exactly one retry: if the second attempt is also unauthorised, the session
 * is genuinely gone and looping would only delay telling the user.
 */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const response = await send(path, options, useAuthStore.getState().accessToken);

  if (response.status !== 401 || options.skipAuthRetry) return response;

  const token = await refreshSession();
  if (!token) return response;

  const retried = await send(path, options, token);

  // Still unauthorised with a token minted seconds ago: the account lost
  // access rather than the token expiring. Drop the session so the router
  // sends them to /login instead of leaving a dead shell on screen.
  if (retried.status === 401) useAuthStore.getState().clearSession();

  return retried;
}

/** Requests `path` and validates the response against the shared schema. */
export async function api<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const response = await apiFetch(path, options);

  if (!response.ok) throw await toApiError(response);

  // Parsing with the same schema the server validated against means a backend
  // that drifts from the contract fails loudly here, rather than producing
  // `undefined` three components deep.
  return schema.parse(await response.json());
}

/** Requests `path` where the response body is empty or uninteresting (204). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  const response = await apiFetch(path, options);
  if (!response.ok) throw await toApiError(response);
}

/** Test-only: drops any in-flight refresh so suites do not leak state. */
export function resetRefreshState(): void {
  refreshInFlight = null;
}
