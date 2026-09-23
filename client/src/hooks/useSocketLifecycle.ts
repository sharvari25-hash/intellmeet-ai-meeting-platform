import { useEffect } from 'react';
import { connectSocket } from '@/lib/socket';
import { useAuthStore } from '@/stores/authStore';
import { useSocketStore } from '@/stores/socketStore';

/**
 * Keeps exactly one socket alive for as long as the user is signed in.
 *
 * Called from the authenticated shell rather than from the root component, for
 * two reasons. The socket is only meaningful once there is a session, and
 * keeping the import here means socket.io-client ships in the shell's lazy
 * chunk instead of in the bundle a visitor downloads to read the landing page.
 *
 * Deliberately no cleanup function: StrictMode would then disconnect and
 * reconnect on mount for no reason. Sign-out is handled by the status change
 * below and by the logout mutation, which tears the socket down explicitly
 * because this component unmounts in the same tick.
 */
export function useSocketLifecycle(): void {
  const status = useAuthStore((state) => state.status);
  const teardown = useSocketStore((state) => state.teardown);

  useEffect(() => {
    if (status === 'authenticated') {
      connectSocket();
      return;
    }

    // Covers a session that expired while the tab was idle.
    if (status === 'anonymous') teardown();
  }, [status, teardown]);
}
