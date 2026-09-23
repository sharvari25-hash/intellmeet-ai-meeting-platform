const STORAGE_KEY = 'intellmeet-pending-invite';

/**
 * An invite code a signed-out visitor arrived with, parked until they have an
 * account.
 *
 * Router state alone is not enough. It carries the code fine when the visitor
 * uses the buttons on the invite screen, but it is gone the moment they reach
 * the sign-up form any other way - opening /register in a second tab,
 * following an email link, or bouncing through a password manager. The code
 * then silently vanishes and they land in the app without the team they were
 * invited to, which is exactly the bug this file exists to close.
 *
 * `sessionStorage`, not `localStorage`: an invite is relevant to the visit it
 * arrived in, not forever on this device.
 */
export function rememberInvite(code: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Private browsing and hardened settings throw rather than no-op. The
    // router-state path still works, so this is a fallback losing a fallback.
  }
}

/**
 * Reads the parked code without consuming it.
 *
 * Deliberately non-destructive: two different places decide where a freshly
 * signed-in user goes (the auth mutation and the public-only route guard), and
 * whichever of them ran first would otherwise clear the code out from under
 * the other - which is the same class of race this fix is about.
 */
export function peekPendingInvite(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Consumed by the join page once it has actually tried to redeem the code. */
export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage was never readable.
  }
}
