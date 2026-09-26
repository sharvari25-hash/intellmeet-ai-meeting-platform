const STORAGE_KEY = 'intellmeet-return-path';

/**
 * The page a signed-out visitor was sent away from, parked until they have a
 * session.
 *
 * Router state carries it to /login, and signing in there returns them to it.
 * It does not survive leaving that page: somebody who opens a meeting link on
 * a phone, is sent to the sign-in form, and taps through to the landing page
 * to use Try Live Demo - the obvious move for someone with no account - lost
 * the room and landed on the dashboard. Same idea as `pendingInvite`, and
 * `sessionStorage` for the same reason: it belongs to this visit only.
 */
export function rememberReturnPath(path: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Private browsing and hardened settings throw rather than no-op; the
    // router-state path still works.
  }
}

/**
 * Reads the parked path without consuming it: the sign-in mutation and the
 * public-only route guard both decide where to go, in the same commit.
 */
export function peekReturnPath(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Consumed once a signed-in visitor is inside the app. */
export function clearReturnPath(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage was never readable.
  }
}
