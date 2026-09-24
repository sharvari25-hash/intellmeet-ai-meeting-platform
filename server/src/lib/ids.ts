import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Types } from 'mongoose';

/**
 * Alphabet for human-facing codes (team invites now, meeting room codes in
 * Phase 3).
 *
 * Crockford-style: no `I`, `L`, `O`, `U`, `0` or `1`. Those are the characters
 * people mistype when reading a code off a screen or hearing it on a call, and
 * an invite code that "doesn't work" is indistinguishable from a bug.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/**
 * Generates an unbiased random code.
 *
 * `randomInt` is used rather than `randomBytes(n) % alphabet.length`, which
 * skews towards the first characters whenever 256 is not a multiple of the
 * alphabet length.
 */
export function generateCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * An ObjectId derived from a string: the same on every run and every machine.
 *
 * For seeded records that other records point at - a sample meeting's action
 * items, the demo board's columns. With random ids every re-seed would mint
 * new ones and break every task linked to the old ones.
 */
export function stableObjectId(seed: string): Types.ObjectId {
  return new Types.ObjectId(createHash('sha1').update(seed).digest('hex').slice(0, 24));
}

/** 32 bytes of CSPRNG output, base64url-encoded. Used for refresh tokens. */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Turns a team name into a URL-safe slug, with a short random suffix so two
 * teams called "Design" do not collide on the unique index.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFKD')
    // Strip combining marks so "Café" becomes "Cafe" rather than "Caf".
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  const suffix = generateCode(5).toLowerCase();
  return base ? `${base}-${suffix}` : `team-${suffix}`;
}
