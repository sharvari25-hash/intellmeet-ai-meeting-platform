import { z } from 'zod';
import type { TranscriptSegment } from '@intellmeet/shared';

/**
 * The seam between the meeting pipeline and whichever AI vendor is behind it.
 *
 * The pipeline only ever calls these two methods, so Groq, Gemini and the
 * offline mock are interchangeable - chosen by `AI_PROVIDER`, not by code.
 */
export interface AIProvider {
  /** Recorded in the Transcript/Insight, so it is clear which model produced what. */
  readonly name: string;

  /**
   * Largest audio payload one `transcribe` call accepts. The pipeline splits
   * anything bigger with ffmpeg before calling.
   */
  readonly maxAudioBytes: number;

  transcribe(audio: AudioInput): Promise<TranscriptionResult>;

  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}

export interface AudioInput {
  data: Buffer;
  mimeType: string;
  /** Some APIs infer the container from the extension, so it has to be right. */
  filename: string;
  /**
   * What the meeting was about and who was in it. Real speech recognition
   * ignores this; the mock uses it to produce a plausible transcript, and a
   * provider that accepts a prompt can use the names as spelling hints.
   */
  context: MeetingContext;
}

export interface MeetingContext {
  title: string;
  participantNames: string[];
  /** When the meeting happened, for resolving "by Friday" into a date. */
  meetingDate: Date;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  language: string | null;
  provider: string;
}

export interface AnalysisInput extends MeetingContext {
  segments: TranscriptSegment[];
}

/**
 * The strict JSON a model must return.
 *
 * Deliberately strict: `dueDate` must already be an ISO date, not "Friday" -
 * a vague value that slips through here becomes a Kanban task nobody can sort.
 * A reply that fails this schema gets one repair attempt (see analysis.ts).
 *
 * Two leniencies, both for things models do constantly and that carry no
 * ambiguity: an empty string where null was meant, and surrounding whitespace.
 */
const nullableText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).nullable(),
);

export const meetingAnalysisSchema = z.object({
  summary: z.string().trim().min(1, 'summary must not be empty').max(4000),
  keyDecisions: z.array(z.string().trim().min(1)).max(50),
  actionItems: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(500),
        assigneeName: nullableText,
        dueDate: z.preprocess(
          (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
          z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate must be YYYY-MM-DD or null')
            .nullable(),
        ),
      }),
    )
    .max(100),
});
export type MeetingAnalysis = z.infer<typeof meetingAnalysisSchema>;

export interface AnalysisResult extends MeetingAnalysis {
  provider: string;
}

/** One turn of a chat completion, in the vendor-neutral shape analysis.ts uses. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
}

/** Sends a chat completion and returns the raw text of the reply. */
export type CompleteFn = (request: CompletionRequest) => Promise<string>;

/**
 * A failure talking to a vendor.
 *
 * `retryable` separates "try again later" (rate limited, the vendor is down)
 * from "this will never work" (bad key, file rejected), so the job queue does
 * not burn its retries on a revoked API key.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** The model's reply was still not valid JSON for the schema after a repair attempt. */
export class AnalysisFormatError extends Error {
  constructor(
    message: string,
    readonly lastReply: string,
  ) {
    super(message);
    this.name = 'AnalysisFormatError';
  }
}
