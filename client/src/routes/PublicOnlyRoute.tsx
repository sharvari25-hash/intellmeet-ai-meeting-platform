import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { postAuthPath } from '@/features/auth/postAuthPath';
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

  if (status === 'bootstrapping') return <FullPageSpinner label="Checking your session" />;

  if (status === 'authenticated') {
    return <Navigate to={postAuthPath(location.state, peekPendingInvite())} replace />;
  }

  return <Outlet />;
}
