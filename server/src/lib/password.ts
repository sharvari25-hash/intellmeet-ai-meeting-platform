import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

/**
 * bcrypt, via `bcryptjs` rather than the native `bcrypt` binding.
 *
 * The native package needs node-gyp or a matching prebuilt binary; the
 * production image is `node:22-alpine` (musl), where prebuilds routinely miss
 * and the build falls back to compiling inside the Docker image. `bcryptjs` is
 * pure JavaScript, so the image builds identically everywhere. It is roughly
 * 2-3x slower per hash, which is irrelevant at login rates and, if anything,
 * slightly raises the attacker's cost too.
 *
 * The work factor comes from `BCRYPT_COST` (12 in production, lowered under
 * test) so the suite is not spending minutes on deliberately slow hashing.
 */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A bcrypt hash of a throwaway value, used to equalise the cost of a login
 * attempt against a non-existent account.
 *
 * Without it, "unknown email" returns in ~1ms while "wrong password" takes
 * ~350ms, and that gap is a reliable account-enumeration oracle. Computed once
 * at first use rather than at import so startup is not delayed.
 */
let dummyHash: string | undefined;

export async function burnPasswordComparison(): Promise<void> {
  dummyHash ??= await hashPassword('intellmeet-timing-equaliser');
  await verifyPassword('not-the-password', dummyHash);
}
