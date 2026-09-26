import { create } from 'zustand';
import type { PublicUser } from '@intellmeet/shared';

/**
 * Where the session lives while a tab is open.
 *
 * `bootstrapping` is the state before the first refresh attempt has settled.
 * It exists so a protected route can show a spinner instead of bouncing a
 * signed-in user to /login for the few hundred milliseconds it takes to swap
 * the refresh cookie for an access token on a hard reload.
 */
export type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  /**
   * Held in a plain JavaScript variable and deliberately never written to
   * localStorage or a cookie.
   *
   * localStorage is readable by any script on the origin, so one XSS would
   * hand an attacker a token usable from their own machine. Memory dies with
   * the tab, which is why the refresh cookie (httpOnly, so script cannot read
   * it at all) is what survives a reload instead.
   */
  accessToken: string | null;
  /**
   * Whether the session ended because the user signed out, rather than
   * expiring or being revoked. ProtectedRoute sends the first home and the
   * second to sign in again - and only the second should come back to the
   * page it was on.
   */
  signedOut: boolean;
  setSession: (user: PublicUser, accessToken: string) => void;
  /** Updates the token after a silent refresh, leaving the user object alone. */
  setAccessToken: (accessToken: string) => void;
  setUser: (user: PublicUser) => void;
  clearSession: (options?: { signedOut?: boolean }) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'bootstrapping',
  user: null,
  accessToken: null,
  signedOut: false,

  setSession: (user, accessToken) =>
    set({ status: 'authenticated', user, accessToken, signedOut: false }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  clearSession: (options) =>
    set({
      status: 'anonymous',
      user: null,
      accessToken: null,
      signedOut: options?.signedOut ?? false,
    }),
}));

/**
 * Reads the token outside React.
 *
 * The API client and the socket singleton are not components, so they cannot
 * use the hook. Zustand's `getState` is the supported escape hatch and always
 * returns the current value rather than one captured in a closure.
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
