/**
 * How a meeting-history search query is read into words.
 *
 * MongoDB's text index does the actual matching and ranking. These helpers
 * serve the two things around it that must agree with each other: the server
 * uses them to pick the sentence that explains *why* a meeting matched, and
 * the client uses them to highlight the same words in that sentence. One
 * implementation, so the highlighted word is always the one that was found.
 *
 * Mongo stems English ("planning" and "plans" both index as "plan"), so a
 * literal comparison would miss most real matches. `stem` is a deliberately
 * small approximation - strip a common suffix, then match any word that
 * starts with what is left - which is right for highlighting, where a rare
 * extra highlight costs nothing and a missing one looks like a bug.
 */

/** Longest first, so "ations" is tried before "s". */
const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 'ly', 's'];

/** A stem shorter than this matches too much ("notes" must not become "not"). */
const MIN_STEM = 4;

const MAX_TERMS = 10;

/** Reduces a word to a prefix that its inflections share. */
export function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      const base = word.slice(0, -suffix.length);
      // "planning" -> "plann" -> "plan", so "plan" and "plans" match too.
      const last = base.at(-1);
      return last && base.at(-2) === last && base.length > MIN_STEM ? base.slice(0, -1) : base;
    }
  }
  return word;
}

/**
 * The words a query searches for, lower-cased and de-duplicated.
 *
 * Follows Mongo's `$search` syntax closely enough to agree with it: quotes
 * (phrases) are ignored because each word of a phrase is still highlighted, a
 * `-word` is an exclusion and never a match, and one-letter tokens are noise.
 */
export function searchTerms(query: string): string[] {
  const words = query
    .replace(/["“”]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !token.startsWith('-'))
    .map((token) => token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token.length >= 2);

  return [...new Set(words)].slice(0, MAX_TERMS);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A pattern matching every whole word that begins with one of the terms'
 * stems, case-insensitively and in any script. Null when there is nothing to
 * match, so callers never build a pattern that matches everything.
 *
 * Global (`g`), so callers that test with it must reset `lastIndex` or use
 * `String.prototype.match`/`matchAll`, which do it for them.
 */
export function termPattern(terms: readonly string[]): RegExp | null {
  const stems = [...new Set(terms.map(stem))].filter(Boolean);
  if (stems.length === 0) return null;

  // Unicode-aware word start: `\b` only understands ASCII letters.
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${stems.map(escapeRegExp).join('|')})[\\p{L}\\p{N}]*`,
    'giu',
  );
}
