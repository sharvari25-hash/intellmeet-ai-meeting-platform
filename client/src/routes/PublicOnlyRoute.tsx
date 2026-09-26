import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { postAuthPath } from '@/features/auth/postAuthPath';
import { peekReturnPath, rememberReturnPath } from '@/features/auth/returnPath';
import { peekPendingInvite } from '@/features/teams/pendingInvite';
import { useAuthStore } from '@/stores/authStore';

/**
 * The inverse of ProtectedRoute: keeps a signed-in user off /login and
 * /register, which would otherwise offer to sign them in a second time.
 *
 * The destination comes from `postAuthPath` rather than being hardcoded. This
 * guard and the sign-in mutation both redirect in the same React commit, so a
 * literal '/app' here silently overwrote wherever the user was actually headed
 * - which is how an invite link ended up dropping people on the dashboard
 * without joining the team.
 */
export function PublicOnlyRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  // A visitor sent here from a page inside the app may still leave for the
  // landing page's Try Live Demo, which has no router state to read; parking
  // the page lets that sign-in return them to it too (see `returnPath`).
  // Parked here rather than in ProtectedRoute: signing out also makes the
  // session anonymous on an /app page, and that page must not be parked.
  useEffect(() => {
    if (status === 'anonymous' && from) rememberReturnPath(from);
  }, [status, from]);

  if (status === 'bootstrapping') return <FullPageSpinner label="Checking your session" />;

  if (status === 'authenticated') {
    return (
      <Navigate to={postAuthPath(location.state, peekPendingInvite(), peekReturnPath())} replace />
    );
  }

  return <Outlet />;
}
