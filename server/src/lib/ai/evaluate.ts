import { nameScore, MATCH_THRESHOLD } from './assignee.js';
import type { MeetingAnalysis } from './types.js';

/**
 * Scores a model's analysis against a hand-written reference.
 *
 * This is a *reading aid*, not a verdict. Matching is by shared keywords, so a
 * faithful paraphrase can be missed and a lucky overlap can be counted. The
 * evaluation script prints every pairing next to its score precisely so a
 * person can overrule it - the plan's >85% accuracy target is judged by
 * reading, and these numbers say where to look first.
 */

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'will',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'but',
  'not',
  'all',
  'any',
  'can',
  'its',
  'our',
  'their',
  'they',
  'them',
  'then',
  'than',
  'out',
  'use',
  'next',
  'by',
  'to',
  'of',
  'on',
  'in',
  'a',
  'an',
  'is',
  'be',
  'it',
  'as',
  'at',
  'or',
  'so',
  'we',
  'us',
  'up',
]);

/** Content words, lower-cased, with a crude plural/suffix trim. */
export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
      .map((word) => word.replace(/(ing|ed|es|s)$/, '')),
  );
}

/** Dice coefficient over keywords: 1 for the same words, 0 for none shared. */
export function similarity(a: string, b: string): number {
  const left = keywords(a);
  const right = keywords(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** Two items refer to the same thing at or above this similarity. */
export const ITEM_MATCH_THRESHOLD = 0.35;

export interface Pairing<P, R> {
  produced: P;
  reference: R;
  score: number;
}

/**
 * Pairs produced items with reference items, best match first, each used once.
 * Greedy is enough here: lists are a handful of items long.
 */
export function pairItems<P, R>(
  produced: P[],
  reference: R[],
  textOf: { produced: (item: P) => string; reference: (item: R) => string },
): { pairs: Pairing<P, R>[]; missed: R[]; extra: P[] } {
  const candidates: { p: number; r: number; score: number }[] = [];
  produced.forEach((item, p) =>
    reference.forEach((ref, r) =>
      candidates.push({ p, r, score: similarity(textOf.produced(item), textOf.reference(ref)) }),
    ),
  );
  candidates.sort((a, b) => b.score - a.score);

  const usedP = new Set<number>();
  const usedR = new Set<number>();
  const pairs: Pairing<P, R>[] = [];

  for (const candidate of candidates) {
    if (candidate.score < ITEM_MATCH_THRESHOLD) break;
    if (usedP.has(candidate.p) || usedR.has(candidate.r)) continue;
    usedP.add(candidate.p);
    usedR.add(candidate.r);
    pairs.push({
      produced: produced[candidate.p] as P,
      reference: reference[candidate.r] as R,
      score: candidate.score,
    });
  }

  return {
    pairs,
    missed: reference.filter((_, index) => !usedR.has(index)),
    extra: produced.filter((_, index) => !usedP.has(index)),
  };
}

type ActionItem = MeetingAnalysis['actionItems'][number];

/** Whether the model's owner is the reference owner ("Grace" counts for "Grace Hopper"). */
export function sameAssignee(produced: string | null, reference: string | null): boolean {
  if (!produced || !reference) return produced === reference;
  return nameScore(produced, reference) >= MATCH_THRESHOLD;
}

export interface EvaluationScore {
  decisions: { matched: number; produced: number; reference: number };
  actionItems: { matched: number; produced: number; reference: number };
  /** Of the matched action items, how many have the right owner / deadline. */
  assigneeCorrect: number;
  dueDateCorrect: number;
  /** Reference action items found with the right owner *and* deadline. */
  fullyCorrect: number;
}

export interface Evaluation {
  score: EvaluationScore;
  decisions: ReturnType<typeof pairItems<string, string>>;
  actionItems: ReturnType<typeof pairItems<ActionItem, ActionItem>>;
  summarySimilarity: number;
}

export function evaluateAnalysis(
  produced: MeetingAnalysis,
  reference: MeetingAnalysis,
): Evaluation {
  const decisions = pairItems(produced.keyDecisions, reference.keyDecisions, {
    produced: (text) => text,
    reference: (text) => text,
  });

  const actionItems = pairItems(produced.actionItems, reference.actionItems, {
    produced: (item) => item.text,
    reference: (item) => item.text,
  });

  let assigneeCorrect = 0;
  let dueDateCorrect = 0;
  let fullyCorrect = 0;
  for (const pair of actionItems.pairs) {
    const owner = sameAssignee(pair.produced.assigneeName, pair.reference.assigneeName);
    const due = pair.produced.dueDate === pair.reference.dueDate;
    if (owner) assigneeCorrect += 1;
    if (due) dueDateCorrect += 1;
    if (owner && due) fullyCorrect += 1;
  }

  return {
    decisions,
    actionItems,
    summarySimilarity: similarity(produced.summary, reference.summary),
    score: {
      decisions: {
        matched: decisions.pairs.length,
        produced: produced.keyDecisions.length,
        reference: reference.keyDecisions.length,
      },
      actionItems: {
        matched: actionItems.pairs.length,
        produced: produced.actionItems.length,
        reference: reference.actionItems.length,
      },
      assigneeCorrect,
      dueDateCorrect,
      fullyCorrect,
    },
  };
}
