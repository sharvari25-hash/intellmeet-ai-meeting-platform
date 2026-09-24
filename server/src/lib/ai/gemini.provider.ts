import { z } from 'zod';
import { analyzeWithLlm } from './analysis.js';
import { postJson } from './http.js';
import {
  ProviderError,
  type AIProvider,
  type AnalysisInput,
  type AnalysisResult,
  type AudioInput,
  type CompletionRequest,
  type TranscriptionResult,
} from './types.js';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

const generateResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional(),
      }),
    )
    .min(1),
});

/**
 * Seconds from a timestamp as a model writes it: `75.5`, `"75.5"`, `"75.5s"`,
 * `"01:15"`, `"1:01:15.5"`. Asked for seconds, models still answer in clock
 * form often enough that rejecting it would throw away a good transcript.
 */
export function toSeconds(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim().replace(/s$/i, '');
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);

  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(text);
  if (!clock) return null;
  const [, hours = '0', minutes = '0', seconds = '0'] = clock;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

const timestamp = z.unknown().transform((value, ctx) => {
  const seconds = toSeconds(value);
  if (seconds === null) {
    ctx.addIssue({ code: 'custom', message: 'not a timestamp' });
    return z.NEVER;
  }
  return seconds;
});

const segmentSchema = z.object({ start: timestamp, end: timestamp, text: z.string() });

/** `{ language, segments }`, or just the segments array. */
const transcriptJsonSchema = z.union([
  z.object({ language: z.string().nullish(), segments: z.array(segmentSchema) }),
  z.array(segmentSchema).transform((segments) => ({ language: null, segments })),
]);

/** Reads the transcription reply, tolerating a Markdown fence around the JSON. */
export function parseTranscriptReply(reply: string): z.infer<typeof transcriptJsonSchema> | null {
  const text = reply
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const parsed = transcriptJsonSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The MIME type to declare for a recording.
 *
 * Gemini accepts WebM, Ogg, Opus, MP3, M4A, AAC, WAV and FLAC, but by its own
 * names: parameters such as `;codecs=opus` are dropped, and the MP4 audio that
 * Safari records (`audio/mp4`) is declared as `audio/m4a`, which it is.
 */
export function geminiAudioMimeType(mimeType: string): string {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  switch (base) {
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'audio/m4a';
    case 'audio/x-wav':
    case 'audio/wave':
      return 'audio/wav';
    case '':
      return 'audio/webm';
    default:
      return base;
  }
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
}

/**
 * Google Gemini: the production provider (and the fallback behind Groq).
 *
 * One multimodal model does both jobs: audio goes in as inline data with a
 * request for timestamped JSON segments. The key travels in the
 * `x-goog-api-key` header rather than the `?key=` query parameter the docs
 * often show, so it can never appear in a logged URL.
 *
 * No `temperature` is sent. Google recommends the default (1.0) for Gemini 3
 * models and warns that lower values can make them loop, which in a
 * transcription means the same sentence repeated to the end of the reply.
 * The prompts, the JSON response type and the schema do the constraining.
 */
export class GeminiProvider implements AIProvider {
  /** `gemini:<model>`, so a stored transcript says which model wrote it. */
  readonly name: string;
  /**
   * Inline requests are capped at 20 MB *after* base64, which inflates by a
   * third. 14 MB of audio stays safely under.
   */
  readonly maxAudioBytes = 14 * 1024 * 1024;

  constructor(private readonly options: GeminiOptions) {
    this.name = `gemini:${options.model}`;
  }

  private async generate(body: unknown): Promise<string> {
    const raw = await postJson(this.name, `${GEMINI_API}/${this.options.model}:generateContent`, {
      headers: { 'x-goog-api-key': this.options.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const parsed = generateResponseSchema.safeParse(raw);
    const text = parsed.success
      ? (parsed.data.candidates[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('')
      : '';

    // No text usually means the reply was blocked by a safety filter.
    if (!text) throw new ProviderError(this.name, 'gemini returned no text', null, false);
    return text;
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const reply = await this.generate({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: geminiAudioMimeType(audio.mimeType),
                data: audio.data.toString('base64'),
              },
            },
            {
              text: [
                'Transcribe this meeting recording verbatim, in the language that is spoken.',
                `Participants, for spelling names: ${audio.context.participantNames.join(', ') || 'unknown'}.`,
                'Reply with JSON: {"language": string, "segments": [{"start": number, "end": number, "text": string}]}',
                'with one segment per sentence or short utterance, in order.',
                '"start" and "end" are seconds from the beginning of the recording, as plain numbers (for example 75.5).',
                'Do not summarise, translate or add anything that was not said.',
                'If nobody speaks, reply with an empty "segments" array.',
              ].join(' '),
            },
          ],
        },
      ],
      generationConfig: { responseMimeType: 'application/json' },
    });

    const segments = parseTranscriptReply(reply);
    if (!segments) {
      throw new ProviderError(
        this.name,
        'gemini returned a transcript that is not valid JSON',
        null,
        true,
      );
    }

    const cleaned = segments.segments.map((segment) => ({
      start: Math.max(0, segment.start),
      end: Math.max(segment.start, segment.end),
      text: segment.text.trim(),
      speaker: null,
    }));

    return {
      text: cleaned.map((segment) => segment.text).join(' '),
      segments: cleaned,
      language: segments.language ?? null,
      provider: this.name,
    };
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const analysis = await analyzeWithLlm((request) => this.complete(request), input);
    return { ...analysis, provider: this.name };
  }

  async complete(request: CompletionRequest): Promise<string> {
    return this.generate({
      systemInstruction: { parts: [{ text: request.system }] },
      contents: request.messages.map((message) => ({
        // Gemini calls the assistant turn "model".
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      generationConfig: { responseMimeType: 'application/json' },
    });
  }
}
