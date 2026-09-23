import type { TranscriptSegment } from '@intellmeet/shared';
import {
  AnalysisFormatError,
  meetingAnalysisSchema,
  type AnalysisInput,
  type CompleteFn,
  type MeetingAnalysis,
} from './types.js';

/**
 * Longest transcript sent to the model, in characters.
 *
 * Roughly 12k tokens - an hour of brisk conversation fits whole. Beyond this
 * the middle is elided rather than the end: openings set the agenda and
 * closings are where decisions and owners get restated, so those are the two
 * parts an analysis can least afford to lose.
 */
export const MAX_TRANSCRIPT_CHARS = 48_000;

/** "12:05" style offset, which is how people refer to moments in a meeting. */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Renders segments as the model sees them: `[mm:ss] Speaker: text`. */
export function formatTranscript(segments: TranscriptSegment[]): string {
  const lines = segments.map((segment) => {
    const who = segment.speaker ? `${segment.speaker}: ` : '';
    return `[${formatTimestamp(segment.start)}] ${who}${segment.text.trim()}`;
  });

  const full = lines.join('\n');
  if (full.length <= MAX_TRANSCRIPT_CHARS) return full;

  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return `${full.slice(0, half)}\n[... middle of the meeting omitted for length ...]\n${full.slice(-half)}`;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const weekday = (date: Date) =>
  date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/**
 * The instructions. The JSON shape is spelled out literally, because models
 * follow an example far more reliably than a description of one.
 */
export function buildSystemPrompt(input: AnalysisInput): string {
  return [
    'You analyse meeting transcripts for a team collaboration tool.',
    'Reply with ONE JSON object and nothing else - no prose, no markdown fences.',
    '',
    'The object must have exactly this shape:',
    '{',
    '  "summary": string,',
    '  "keyDecisions": string[],',
    '  "actionItems": [{ "text": string, "assigneeName": string | null, "dueDate": "YYYY-MM-DD" | null }]',
    '}',
    '',
    'Rules:',
    '- summary: 3 to 6 sentences, neutral and factual, past tense. What was discussed and where it landed.',
    '- keyDecisions: only things the group actually agreed or decided. Not proposals, not open questions. Empty array if none.',
    '- actionItems: concrete tasks somebody committed to or was asked to do. One task per item, written as an instruction ("Update the pricing page").',
    `- assigneeName: the owner, spelled exactly as one of these participants: ${input.participantNames.join(', ') || '(none listed)'}. Use null if nobody owns it.`,
    `- dueDate: only if a deadline was actually stated. The meeting took place on ${weekday(input.meetingDate)} ${isoDate(input.meetingDate)}; resolve relative dates ("Friday", "next week", "tomorrow") against that. Otherwise null.`,
    '- Never invent people, decisions, tasks or dates that are not in the transcript.',
  ].join('\n');
}

export function buildUserPrompt(input: AnalysisInput): string {
  return [
    `Meeting title: ${input.title}`,
    `Participants: ${input.participantNames.join(', ') || 'unknown'}`,
    '',
    'Transcript:',
    formatTranscript(input.segments),
  ].join('\n');
}

/**
 * Pulls the JSON object out of a model reply.
 *
 * Asked for bare JSON, models still wrap it in ```json fences or add "Here is
 * the analysis:" often enough that treating that as failure would waste a
 * repair round trip on something trivially recoverable. Anything past that -
 * truncated output, trailing commas, a list instead of an object - is left for
 * the schema and the repair prompt.
 */
export function extractJson(reply: string): unknown {
  const text = reply
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end <= start) throw new SyntaxError('No JSON object found in the reply');
  return JSON.parse(text.slice(start, end + 1));
}

export type ParseOutcome = { ok: true; value: MeetingAnalysis } | { ok: false; problem: string };

/** Validates a reply against the schema, describing what is wrong if it fails. */
export function parseAnalysis(reply: string): ParseOutcome {
  let json: unknown;
  try {
    json = extractJson(reply);
  } catch (error) {
    return { ok: false, problem: `The reply was not valid JSON (${(error as Error).message}).` };
  }

  const parsed = meetingAnalysisSchema.safeParse(json);
  if (parsed.success) return { ok: true, value: parsed.data };

  const issues = parsed.error.issues
    .slice(0, 8)
    .map((issue) => `- ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  return { ok: false, problem: `The JSON did not match the required shape:\n${issues}` };
}

export function buildRepairPrompt(problem: string): string {
  return [
    'Your previous reply could not be used.',
    problem,
    '',
    'Reply again with ONLY the corrected JSON object, in exactly the shape described in the instructions.',
  ].join('\n');
}

/**
 * Asks a chat model for the analysis, validates it, and repairs once.
 *
 * Exactly one repair: the conversation is replayed with the model's own reply
 * and a precise description of what was wrong, which fixes the common cases
 * (a missing field, a "Friday" where a date belongs). A model that fails twice
 * is not going to succeed on the third try of the same prompt, and the job
 * queue's own retry is a better place to spend the next attempt.
 */
export async function analyzeWithLlm(
  complete: CompleteFn,
  input: AnalysisInput,
): Promise<MeetingAnalysis> {
  const system = buildSystemPrompt(input);
  const user = buildUserPrompt(input);

  const first = await complete({ system, messages: [{ role: 'user', content: user }] });
  const firstOutcome = parseAnalysis(first);
  if (firstOutcome.ok) return firstOutcome.value;

  const second = await complete({
    system,
    messages: [
      { role: 'user', content: user },
      { role: 'assistant', content: first },
      { role: 'user', content: buildRepairPrompt(firstOutcome.problem) },
    ],
  });

  const secondOutcome = parseAnalysis(second);
  if (secondOutcome.ok) return secondOutcome.value;

  throw new AnalysisFormatError(
    `The model returned invalid output twice. ${secondOutcome.problem}`,
    second,
  );
}
