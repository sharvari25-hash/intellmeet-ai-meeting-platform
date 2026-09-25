/**
 * An id for this browser, the same in every tab of it.
 *
 * Sent when joining a meeting room, so the server can tell two tabs of one
 * browser (a mistake: they connect to each other and echo) from one person on
 * two devices (fine: a laptop sharing a screen, a phone for the camera).
 *
 * localStorage is what every tab of a browser profile shares and another
 * device does not. It is random, identifies nothing but the browser, and is
 * never shown to anyone else. If storage is blocked, each tab gets an id of its
 * own, which is exactly the behaviour before this existed: the tabs count as
 * separate devices.
 */

const STORAGE_KEY = 'intellmeet-device';

let fallback: string | null = null;

/** 32 hex characters. `getRandomValues`, unlike `randomUUID`, also works over plain http on a LAN. */
function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;

    const created = randomId();
    localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    fallback ??= randomId();
    return fallback;
  }
}
