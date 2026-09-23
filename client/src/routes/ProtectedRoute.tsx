import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { useAuthStore } from '@/stores/authStore';

/**
 * Gate for everything under /app.
 *
 * The three-way status matters: redirecting while the session is still being
 * restored would bounce a signed-in user to /login on every hard reload, and
 * they would land back on the dashboard a moment later having lost whatever
 * page they were on.
 *
 * This is convenience, not security. Every protected route's data comes from
 * an endpoint that checks the bearer token itself; a user who edits their way
 * past this guard sees an empty shell and a stack of 401s.
 */
export function ProtectedRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === 'bootstrapping') return <FullPageSpinner label="Restoring your session" />;

  if (status === 'anonymous') {
    // Carry the intended destination so signing in returns them to it rather
    // than dumping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
