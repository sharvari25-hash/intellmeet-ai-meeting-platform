import type { Types } from 'mongoose';
import {
  searchTerms,
  termPattern,
  type MeetingPreview,
  type MeetingSearchMatch,
} from '@intellmeet/shared';
import { MeetingInsight } from '../ai/insight.model.js';
import { Transcript } from '../ai/transcript.model.js';
import { Meeting, type MeetingDocument } from './meeting.model.js';

/**
 * Meeting history: relevance-ranked search across the three text indexes,
 * the sentence that explains each match, and the summary preview on each row.
 *
 * The indexes already exist - Meeting (title, description), MeetingInsight
 * (summary, decisions) and Transcript (text), one per collection because
 * MongoDB allows one text index per collection. Search queries each and
 * merges the results, rather than copying everything into one searchable
 * document that would have to be kept in sync with three writers.
 */

/** Most hits taken from each index; the ranking keeps the best of them. */
export const SEARCH_CANDIDATES_PER_SOURCE = 200;

/**
 * How much a match in each place counts. A word in the title is the
 * strongest signal a meeting is *about* it; a word somewhere in an hour of
 * transcript is the weakest. Text scores are only comparable within one
 * index, so these weights are a judgement, not arithmetic.
 */
const WEIGHT = { meeting: 3, insight: 2, transcript: 1 } as const;

export interface RankedMeeting {
  id: string;
  score: number;
}

interface TextHit {
  id: Types.ObjectId;
  score: number;
}

/**
 * Every meeting in `scope` matching `q`, best first.
 *
 * `scope` is the caller's authorisation boundary (their teams, and any status
 * filter). The insight and transcript indexes span every tenant, so they are
 * only ever queried *within* the in-scope meeting ids: an unscoped search
 * would rank other teams' meetings too, and could crowd the caller's own out
 * of the candidate limit before the filter removed them.
 *
 * At a much larger scale the next step is to copy `teamId` onto insights and
 * transcripts and prefix their text indexes with it, so no id list is needed.
 */
export async function rankMeetings(
  q: string,
  scope: Record<string, unknown>,
): Promise<RankedMeeting[]> {
  const inScope = await Meeting.find(scope).select('_id startedAt createdAt').lean();
  if (inScope.length === 0) return [];

  const ids = inScope.map((meeting) => meeting._id);
  const text = { $search: q };
  const score = { $meta: 'textScore' } as const;

  const [meetingHits, insightHits, transcriptHits] = await Promise.all([
    Meeting.find({ ...scope, $text: text }, { _id: 1, score })
      .sort({ score })
      .limit(SEARCH_CANDIDATES_PER_SOURCE)
      .lean(),
    MeetingInsight.find({ meetingId: { $in: ids }, $text: text }, { meetingId: 1, score })
      .sort({ score })
      .limit(SEARCH_CANDIDATES_PER_SOURCE)
      .lean(),
    Transcript.find({ meetingId: { $in: ids }, $text: text }, { meetingId: 1, score })
      .sort({ score })
      .limit(SEARCH_CANDIDATES_PER_SOURCE)
      .lean(),
  ]);

  const toHits = (rows: { _id?: Types.ObjectId; meetingId?: Types.ObjectId; score?: number }[]) =>
    rows.flatMap((row): TextHit[] => {
      const id = row.meetingId ?? row._id;
      return id ? [{ id, score: row.score ?? 0 }] : [];
    });

  const scores = new Map<string, number>();
  const addAll = (hits: TextHit[], weight: number) => {
    for (const hit of hits) {
      const key = hit.id.toString();
      scores.set(key, (scores.get(key) ?? 0) + hit.score * weight);
    }
  };
  addAll(toHits(meetingHits), WEIGHT.meeting);
  addAll(toHits(insightHits), WEIGHT.insight);
  addAll(toHits(transcriptHits), WEIGHT.transcript);

  // Equal relevance falls back to recency, so a tie never shuffles between
  // requests and page 2 never repeats a row from page 1.
  const when = new Map(
    inScope.map((meeting) => [
      meeting._id.toString(),
      (meeting.startedAt ?? meeting.createdAt).getTime(),
    ]),
  );

  return [...scores.entries()]
    .map(([id, total]) => ({ id, score: total }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (when.get(b.id) ?? 0) - (when.get(a.id) ?? 0) ||
        b.id.localeCompare(a.id),
    );
}

// --- Snippets -----------------------------------------------------------------

/** A result row has room for about two lines. */
const SNIPPET_LENGTH = 180;

/**
 * The sentence around the first match of `pattern` in `text`, shortened to
 * fit a result row. Null when nothing matches.
 */
export function excerpt(text: string, pattern: RegExp, max = SNIPPET_LENGTH): string | null {
  pattern.lastIndex = 0;
  const match = pattern.exec(text);
  pattern.lastIndex = 0;
  if (!match) return null;

  // The sentence containing the match: back to the previous full stop, on to
  // the next one.
  const before = text.slice(0, match.index);
  const sentenceStart = Math.max(
    0,
    ...['. ', '! ', '? ', '\n'].map((mark) => {
      const at = before.lastIndexOf(mark);
      return at === -1 ? 0 : at + mark.length;
    }),
  );
  const endMatch = /[.!?](\s|$)/.exec(text.slice(match.index));
  const sentenceEnd = endMatch ? match.index + endMatch.index + 1 : text.length;

  if (sentenceEnd - sentenceStart <= max) return text.slice(sentenceStart, sentenceEnd).trim();

  // Too long: a window that starts a little before the match, on a word
  // boundary, so the match itself is never the thing cut off.
  let from = Math.max(sentenceStart, match.index - Math.floor(max / 3));
  if (from > sentenceStart) from = text.indexOf(' ', from) + 1 || from;
  let to = Math.min(sentenceEnd, from + max);
  if (to < sentenceEnd) to = text.lastIndexOf(' ', to) > from ? text.lastIndexOf(' ', to) : to;

  const body = text.slice(from, to).trim();
  return `${from > sentenceStart ? '…' : ''}${body}${to < sentenceEnd ? '…' : ''}`;
}

/** `text` cut to `max` characters on a word boundary, with an ellipsis. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.lastIndexOf(' ', max - 1);
  return `${flat.slice(0, cut > max / 2 ? cut : max - 1).replace(/[,;:.\s]+$/, '')}…`;
}

/**
 * Why each meeting matched, as the sentence to show under it.
 *
 * Mongo reports *that* a document matched, not where. This re-finds the
 * words, most informative place first: a summary sentence says what the
 * meeting decided about the term; a transcript line comes with a timestamp to
 * jump to; a title match needs no snippet, the title is already on screen.
 * Transcripts are only read for meetings nothing else explained, because
 * they are by far the largest documents involved.
 */
export async function describeMatches(
  meetings: Pick<MeetingDocument, '_id' | 'title' | 'description'>[],
  q: string,
): Promise<Map<string, MeetingSearchMatch>> {
  const found = new Map<string, MeetingSearchMatch>();
  const pattern = termPattern(searchTerms(q));
  if (!pattern || meetings.length === 0) return found;

  const ids = meetings.map((meeting) => meeting._id);
  const insights = await MeetingInsight.find({ meetingId: { $in: ids } })
    .select('meetingId summary keyDecisions')
    .lean();

  for (const insight of insights) {
    const key = insight.meetingId.toString();
    const summary = excerpt(insight.summary, pattern);
    if (summary) {
      found.set(key, { source: 'summary', snippet: summary, offsetSec: null });
      continue;
    }
    for (const decision of insight.keyDecisions) {
      const snippet = excerpt(decision, pattern);
      if (snippet) {
        found.set(key, { source: 'decision', snippet, offsetSec: null });
        break;
      }
    }
  }

  const unexplained = ids.filter((id) => !found.has(id.toString()));
  if (unexplained.length > 0) {
    const transcripts = await Transcript.find({ meetingId: { $in: unexplained } })
      .select('meetingId segments')
      .lean();

    for (const transcript of transcripts) {
      for (const segment of transcript.segments) {
        const snippet = excerpt(segment.text, pattern);
        if (!snippet) continue;
        found.set(transcript.meetingId.toString(), {
          source: 'transcript',
          snippet: segment.speaker ? `${segment.speaker}: ${snippet}` : snippet,
          offsetSec: segment.start,
        });
        break;
      }
    }
  }

  for (const meeting of meetings) {
    const key = meeting._id.toString();
    if (found.has(key)) continue;

    const description = meeting.description ? excerpt(meeting.description, pattern) : null;
    if (description) {
      found.set(key, { source: 'description', snippet: description, offsetSec: null });
    } else if (excerpt(meeting.title, pattern)) {
      found.set(key, { source: 'title', snippet: meeting.title, offsetSec: null });
    }
    // Otherwise Mongo's stemmer matched a form this approximation does not
    // recognise; the row simply has no snippet.
  }

  return found;
}

// --- Previews -------------------------------------------------------------------

/** About three lines in a history row. */
const PREVIEW_LENGTH = 240;

/** The summary and counts for each meeting that has an AI insight. */
export async function loadPreviews(ids: Types.ObjectId[]): Promise<Map<string, MeetingPreview>> {
  if (ids.length === 0) return new Map();

  const insights = await MeetingInsight.find({ meetingId: { $in: ids } })
    .select('meetingId summary keyDecisions actionItems.status')
    .lean();

  return new Map(
    insights.map((insight) => [
      insight.meetingId.toString(),
      {
        summary: shorten(insight.summary, PREVIEW_LENGTH),
        keyDecisionCount: insight.keyDecisions.length,
        actionItemCount: insight.actionItems.length,
        openActionItemCount: insight.actionItems.filter((item) => item.status !== 'done').length,
      },
    ]),
  );
}
