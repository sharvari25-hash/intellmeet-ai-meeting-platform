import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { clearReturnPath } from '@/features/auth/returnPath';
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
  const signedOut = useAuthStore((state) => state.signedOut);
  const location = useLocation();

  // A destination parked on the way to /login (see `returnPath`) has done its
  // job once somebody is signed in and inside the app.
  useEffect(() => {
    if (status === 'authenticated') clearReturnPath();
  }, [status]);

  if (status === 'bootstrapping') return <FullPageSpinner label="Restoring your session" />;

  if (status === 'anonymous') {
    // Signing out sends the visitor home, and the sign-out handler says so
    // too. This route re-renders with the cleared session before that
    // navigation lands (router updates are transitions, the store's are not),
    // and it used to answer /login-and-come-back-here instead - so the next
    // person to sign in on this tab was taken to the last one's page.
    if (signedOut) return <Navigate to="/" replace />;

    // Carry the intended destination so signing in returns them to it rather
    // than dumping them on the dashboard.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
