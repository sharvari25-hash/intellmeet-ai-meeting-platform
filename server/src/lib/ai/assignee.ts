/**
 * Matches the name a model wrote for an action item's owner to a participant.
 *
 * Models write names the way people say them - "Grace", "grace h.",
 * "Dr. Hopper", "Alan T" - while participants have their account names. The
 * match is deliberately conservative: a wrong assignee is worse than none,
 * because it silently puts a task on somebody else's board. So it returns a
 * participant only when exactly one of them is the best candidate, and null
 * when the name is unknown *or* ambiguous (two Alexes), leaving the host to
 * pick.
 */

export interface MatchCandidate {
  id: string;
  name: string;
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir']);

/** Lower-case, strip accents and punctuation, drop honorifics. */
export function normalizeName(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter((token) => token.length > 0 && !TITLES.has(token));
}

/** Classic edit distance, for "Grase" -> "Grace" style transcription slips. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
}

/** Similarity of two tokens in [0, 1]. An initial ("h") matches its full token. */
function tokenSimilarity(spoken: string, actual: string): number {
  if (spoken === actual) return 1;
  if (spoken.length === 1) return actual.startsWith(spoken) ? 0.9 : 0;
  // Very short tokens are too easily "close" to each other to trust a fuzzy hit.
  if (spoken.length < 3 || actual.length < 3) return 0;
  return 1 - levenshtein(spoken, actual) / Math.max(spoken.length, actual.length);
}

/**
 * Scores how well a spoken name refers to a participant, in [0, 1].
 *
 * Every spoken token must find a counterpart in the account name ("Grace H"
 * fits "Grace Hopper"; "Grace Kelly" does not). The score is the weakest of
 * those correspondences, so one bad token sinks the match.
 */
export function nameScore(spoken: string, actual: string): number {
  const spokenTokens = normalizeName(spoken);
  const actualTokens = normalizeName(actual);
  if (spokenTokens.length === 0 || actualTokens.length === 0) return 0;

  let weakest = 1;
  for (const token of spokenTokens) {
    const best = Math.max(...actualTokens.map((candidate) => tokenSimilarity(token, candidate)));
    weakest = Math.min(weakest, best);
  }

  return weakest;
}

/** Below this a candidate is not considered a match at all. */
export const MATCH_THRESHOLD = 0.75;

export function matchAssignee<T extends MatchCandidate>(
  spokenName: string | null | undefined,
  participants: readonly T[],
): T | null {
  if (!spokenName?.trim()) return null;

  const scored = participants
    .map((participant) => ({ participant, score: nameScore(spokenName, participant.name) }))
    .filter((entry) => entry.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = scored;
  if (!best) return null;

  // A tie means the name genuinely does not say which person was meant.
  if (runnerUp && runnerUp.score === best.score) return null;

  return best.participant;
}
