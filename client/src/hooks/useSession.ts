import { useEffect } from 'react';
import { refreshSession } from '@/lib/apiClient';

/**
 * Restores the session on a hard reload.
 *
 * The access token only ever lived in memory, so after F5 the app knows
 * nothing. The httpOnly refresh cookie survived, though, so one POST to
 * /api/auth/refresh turns it back into a session. Until that settles the store
 * reports `bootstrapping`, which is why a protected route shows a spinner
 * rather than briefly redirecting a signed-in user to /login.
 *
 * Safe under StrictMode's double-invoked effects: `refreshSession` funnels
 * concurrent callers into a single request.
 */
export function useSessionBootstrap(): void {
  useEffect(() => {
    void refreshSession();
  }, []);
}
