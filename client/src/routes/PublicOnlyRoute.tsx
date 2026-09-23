import { Navigate, Outlet } from 'react-router-dom';
import { FullPageSpinner } from '@/components/Spinner';
import { useAuthStore } from '@/stores/authStore';

/**
 * The inverse of ProtectedRoute: keeps a signed-in user off /login and
 * /register, which would otherwise offer to sign them in a second time.
 */
export function PublicOnlyRoute() {
  const status = useAuthStore((state) => state.status);

  if (status === 'bootstrapping') return <FullPageSpinner label="Checking your session" />;
  if (status === 'authenticated') return <Navigate to="/app" replace />;

  return <Outlet />;
}
