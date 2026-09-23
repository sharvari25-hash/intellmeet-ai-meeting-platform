import { healthResponseSchema, type HealthResponse } from '@intellmeet/shared';

/**
 * Calls the API through the same-origin `/api` path.
 *
 * In dev that path is proxied to localhost:5000 by Vite; in production it is
 * rewritten to the Render service by `vercel.json`. The component therefore
 * never needs to know where the backend actually lives.
 *
 * The response is parsed with the shared zod schema, so a backend that drifts
 * from the contract fails loudly here instead of producing `undefined` deep in
 * the UI.
 */
export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch('/api/health', {
    signal,
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Server responded ${response.status} ${response.statusText}`);
  }

  return healthResponseSchema.parse(await response.json());
}
