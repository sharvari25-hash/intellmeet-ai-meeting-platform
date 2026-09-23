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

const GROQ_API = 'https://api.groq.com/openai/v1';

/** `verbose_json` is the format that includes per-segment timestamps. */
const transcriptionResponseSchema = z.object({
  text: z.string(),
  language: z.string().nullish(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).nullish(),
});

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

export interface GroqOptions {
  apiKey: string;
  transcribeModel: string;
  chatModel: string;
}

/**
 * Groq: Whisper for speech, Llama for the analysis.
 *
 * Plain `fetch` against Groq's OpenAI-compatible endpoints rather than an SDK:
 * two requests do not justify a dependency, and it keeps the request shape
 * visible where it can be reviewed and tested.
 */
export class GroqProvider implements AIProvider {
  readonly name = 'groq';
  /** Groq's free-tier upload limit is 25 MB; stay under it. */
  readonly maxAudioBytes = 24 * 1024 * 1024;

  constructor(private readonly options: GroqOptions) {}

  private get authHeader(): Record<string, string> {
    return { Authorization: `Bearer ${this.options.apiKey}` };
  }

  async transcribe(audio: AudioInput): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }),
      audio.filename,
    );
    form.append('model', this.options.transcribeModel);
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    // Whisper's prompt is a spelling hint, not an instruction: names it would
    // otherwise mishear ("Ada" -> "Aida") come out right.
    if (audio.context.participantNames.length > 0) {
      form.append('prompt', `Participants: ${audio.context.participantNames.join(', ')}.`);
    }

    const raw = await postJson(this.name, `${GROQ_API}/audio/transcriptions`, {
      headers: this.authHeader,
      body: form,
    });

    const parsed = transcriptionResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError(
        this.name,
        'groq returned an unexpected transcription shape',
        null,
        false,
      );
    }

    const segments = (parsed.data.segments ?? []).map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: segment.text.trim(),
      // Whisper does not diarise, so who said what is unknown.
      speaker: null,
    }));

    return {
      text: parsed.data.text.trim(),
      // Some responses omit segments for very short audio; one segment spanning
      // the whole text keeps the transcript renderable.
      segments:
        segments.length > 0
          ? segments
          : [{ start: 0, end: 0, text: parsed.data.text.trim(), speaker: null }],
      language: parsed.data.language ?? null,
      provider: this.name,
    };
  }

  async analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const analysis = await analyzeWithLlm((request) => this.complete(request), input);
    return { ...analysis, provider: this.name };
  }

  async complete(request: CompletionRequest): Promise<string> {
    const raw = await postJson(this.name, `${GROQ_API}/chat/completions`, {
      headers: { ...this.authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.options.chatModel,
        messages: [{ role: 'system', content: request.system }, ...request.messages],
        // Low but not zero: deterministic enough to be consistent, with room
        // to phrase a summary naturally.
        temperature: 0.2,
        // JSON mode: the model is constrained to emit a syntactically valid
        // object. The schema is still enforced by us - JSON mode says nothing
        // about which fields are present.
        response_format: { type: 'json_object' },
      }),
    });

    const parsed = chatResponseSchema.safeParse(raw);
    const content = parsed.success ? parsed.data.choices[0]?.message.content : null;
    if (!content) {
      throw new ProviderError(this.name, 'groq returned an empty completion', null, true);
    }
    return content;
  }
}
