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

const transcriptJsonSchema = z.object({
  language: z.string().nullish(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })),
});

export interface GeminiOptions {
  apiKey: string;
  model: string;
}

/**
 * Google Gemini, the fallback provider.
 *
 * One multimodal model does both jobs: audio goes in as inline data with a
 * request for timestamped JSON segments. The key travels in the
 * `x-goog-api-key` header rather than the `?key=` query parameter the docs
 * often show, so it can never appear in a logged URL.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  /**
   * Inline requests are capped at 20 MB *after* base64, which inflates by a
   * third. 14 MB of audio stays safely under.
   */
  readonly maxAudioBytes = 14 * 1024 * 1024;

  constructor(private readonly options: GeminiOptions) {}

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
            { inlineData: { mimeType: audio.mimeType, data: audio.data.toString('base64') } },
            {
              text: [
                'Transcribe this meeting recording verbatim.',
                `Participants, for spelling: ${audio.context.participantNames.join(', ') || 'unknown'}.`,
                'Reply with JSON: {"language": string, "segments": [{"start": seconds, "end": seconds, "text": string}]}',
                'with one segment per sentence or short utterance, in order.',
              ].join(' '),
            },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });

    let segments: z.infer<typeof transcriptJsonSchema>;
    try {
      segments = transcriptJsonSchema.parse(JSON.parse(reply));
    } catch {
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
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    });
  }
}
