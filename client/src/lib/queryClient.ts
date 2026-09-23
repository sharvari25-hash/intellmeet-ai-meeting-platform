import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiClient';

/**
 * One QueryClient for the app.
 *
 * The defaults below are tuned for a product where most data also arrives over
 * a socket: refetching on every window focus would duplicate work the realtime
 * layer already does, so it is off, and a short stale time absorbs the burst of
 * queries a route change fires.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Retrying a 401/403/404 is pointless - the answer will not change -
          // and retrying a 429 makes the rate limit worse. Only genuinely
          // transient failures are worth a second attempt.
          if (error instanceof ApiError && error.status < 500 && error.status !== 408) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        // A retried mutation is a duplicate write. The user can press the
        // button again if they want to.
        retry: false,
      },
    },
  });
}
