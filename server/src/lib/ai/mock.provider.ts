import type { TranscriptSegment } from '@intellmeet/shared';
import type {
  AIProvider,
  AnalysisInput,
  AnalysisResult,
  AudioInput,
  MeetingAnalysis,
  TranscriptionResult,
} from './types.js';

/**
 * An offline stand-in for a real AI vendor.
 *
 * Used when `AI_PROVIDER=mock` (the default, so the product works with no
 * accounts at all) and throughout the test suite. It is deterministic - the
 * same input always gives the same output - which is what lets tests assert
 * on it.
 *
 * It cannot hear. `transcribe` returns a scripted stand-up that uses the real
 * participants' names, so everything downstream (assignee matching, the
 * meeting page, notifications) is exercised with realistic data.
 *
 * `analyze` is *not* canned: it reads the transcript with simple rules - a
 * sentence with "we agreed" is a decision, "I'll ..." is an action item owned
 * by the speaker. That makes the evaluation script meaningful offline, and
 * gives a baseline any real model has to beat.
 */
export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly maxAudioBytes = Number.POSITIVE_INFINITY;

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const segments = scriptedMeeting(audio.context.title, audio.context.participantNames);
    return {
      text: segments.map((segment) => segment.text).join(' '),
      segments,
      language: 'en',
      provider: this.name,
    };
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    return { ...heuristicAnalysis(input), provider: this.name };
  }
}

/**
 * A short, plausible meeting with a clear decision and clear owners, using
 * whoever was actually in the call. With fewer than three people the lines
 * wrap around, which reads oddly but keeps the structure identical.
 */
export function scriptedMeeting(title: string, names: string[]): TranscriptSegment[] {
  const people = names.length > 0 ? names : ['Host'];
  const who = (index: number) => people[index % people.length] ?? 'Host';
  const first = (index: number) => who(index).split(' ')[0] ?? who(index);

  const lines: [number, string][] = [
    [0, `Thanks for joining. Today is about ${title}, so let's go through status first.`],
    [1, 'The onboarding changes are finished and the tests are green.'],
    [2, 'I am still blocked on the analytics export, the API returns a timeout.'],
    [
      0,
      'We agreed to ship the onboarding changes this week and hold the export until it is fixed.',
    ],
    [1, `I'll write the release notes for the onboarding changes by Friday.`],
    [0, `${first(2)}, can you pair with the backend team on the export timeout?`],
    [2, 'Yes, I will look at the export timeout with them tomorrow.'],
    [0, 'Decision: we will move the weekly demo to Thursday afternoon.'],
    [1, 'Sounds good. Nothing else from me.'],
    [0, 'Great, thanks everyone.'],
  ];

  let clock = 0;
  return lines.map(([speaker, text]) => {
    const start = clock;
    // Roughly speaking pace: 2.5 words a second, plus a beat between turns.
    clock += Math.max(2, Math.round(text.split(/\s+/).length / 2.5)) + 1;
    return { start, end: clock - 1, text, speaker: who(speaker) };
  });
}

// --- Heuristic analysis --------------------------------------------------------

// "decision:" sits outside the \b group: there is no word boundary between a
// colon and the space after it, so inside the group it could never match.
const DECISION =
  /\b(we (have )?(agreed|decided)|agreed to|decided to|let's go with|we'll go with|we will go with|final call|the plan is)\b|\bdecision:/i;

const COMMITMENT = /\b(i'll|i will|i can take|i'm going to|i am going to)\b/i;
const REQUEST = /\b(can you|could you|would you|will you|please)\b/i;
const ACTION = /\baction item\b/i;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Splits a turn into sentences, keeping the punctuation. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Resolves the deadline a sentence states, relative to the meeting date.
 *
 * Only the phrasings people actually use in meetings, and only when they are
 * unambiguous: "Friday" is the next Friday after the meeting, never today.
 */
export function resolveDueDate(sentence: string, meetingDate: Date): string | null {
  const lower = sentence.toLowerCase();
  const day = new Date(
    Date.UTC(meetingDate.getUTCFullYear(), meetingDate.getUTCMonth(), meetingDate.getUTCDate()),
  );

  const plusDays = (days: number) => {
    const next = new Date(day);
    next.setUTCDate(next.getUTCDate() + days);
    return toIsoDate(next);
  };

  if (/\btoday\b/.test(lower)) return plusDays(0);
  if (/\btomorrow\b/.test(lower)) return plusDays(1);
  if (/\b(end of (the )?week|eow)\b/.test(lower))
    return plusDays((5 - day.getUTCDay() + 7) % 7 || 7);
  if (/\bnext week\b/.test(lower)) return plusDays(7);

  for (const [index, name] of WEEKDAYS.entries()) {
    if (new RegExp(`\\b(by |on |before )?${name}\\b`).test(lower)) {
      return plusDays((index - day.getUTCDay() + 7) % 7 || 7);
    }
  }

  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(sentence);
  return iso?.[1] ?? null;
}

/** Turns "I'll write the notes by Friday." into "Write the notes by Friday". */
function asInstruction(sentence: string): string {
  const stripped = sentence
    .replace(/^(yes|yeah|sure|ok|okay|great)[,.]?\s+/i, '')
    .replace(/^[A-Z][a-z]+,\s+/, '')
    .replace(/^(i'll|i will|i can take|i'm going to|i am going to)\s+/i, '')
    .replace(/^(can you|could you|would you|will you|please)\s+/i, '')
    .replace(/^action item:?\s*/i, '')
    .replace(/[?.!]+$/, '')
    .trim();

  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** The participant a request is addressed to: "Grace, can you..." or "can you, Grace". */
function addressee(sentence: string, participantNames: string[]): string | null {
  const lower = sentence.toLowerCase();
  for (const name of participantNames) {
    const firstName = name.split(' ')[0]?.toLowerCase();
    if (firstName && new RegExp(`\\b${firstName}\\b`).test(lower)) return name;
  }
  return null;
}

export function heuristicAnalysis(input: AnalysisInput): MeetingAnalysis {
  const keyDecisions: string[] = [];
  const actionItems: MeetingAnalysis['actionItems'] = [];

  input.segments.forEach((segment, index) => {
    for (const sentence of sentences(segment.text)) {
      if (DECISION.test(sentence)) {
        keyDecisions.push(
          sentence.replace(/^decision:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase()),
        );
        continue;
      }

      const isCommitment = COMMITMENT.test(sentence);
      const isRequest = REQUEST.test(sentence) && sentence.trim().endsWith('?');
      if (!isCommitment && !isRequest && !ACTION.test(sentence)) continue;

      // A commitment belongs to whoever said it; a request to whoever it names,
      // falling back to the person who answers next.
      const assigneeName = isCommitment
        ? segment.speaker
        : (addressee(sentence, input.participantNames) ??
          input.segments[index + 1]?.speaker ??
          null);

      const text = asInstruction(sentence);

      // "Can you look at X?" followed by "Yes, I will look at X" is one task.
      const duplicate = actionItems.find(
        (item) => item.assigneeName === assigneeName && overlap(item.text, text) >= 0.5,
      );
      if (duplicate) {
        duplicate.dueDate ??= resolveDueDate(sentence, input.meetingDate);
        continue;
      }

      actionItems.push({
        text,
        assigneeName,
        dueDate: resolveDueDate(sentence, input.meetingDate),
      });
    }
  });

  const opening = input.segments[0]?.text ?? '';
  const summary = [
    `${input.participantNames.join(', ') || 'The team'} met for "${input.title}".`,
    opening ? `The meeting opened with: "${sentences(opening)[0] ?? opening}"` : '',
    `${keyDecisions.length} decision${keyDecisions.length === 1 ? ' was' : 's were'} recorded and ${actionItems.length} action item${actionItems.length === 1 ? ' was' : 's were'} assigned.`,
  ]
    .filter(Boolean)
    .join(' ');

  return { summary, keyDecisions, actionItems };
}

/** Share of the shorter text's words that also appear in the longer one. */
function overlap(a: string, b: string): number {
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/\W+/)
        .filter((word) => word.length > 3),
    );
  const left = words(a);
  const right = words(b);
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size === 0) return 0;
  let shared = 0;
  for (const word of small) if (large.has(word)) shared += 1;
  return shared / small.size;
}
