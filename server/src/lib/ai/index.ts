import { AI_PROVIDERS, env } from '../../config/env.js';
import { logger } from '../logger.js';
import { GeminiProvider } from './gemini.provider.js';
import { GroqProvider } from './groq.provider.js';
import { MockProvider } from './mock.provider.js';
import type { AIProvider, AnalysisInput, AudioInput } from './types.js';

export type AIProviderName = (typeof AI_PROVIDERS)[number];

/**
 * Tries a primary provider and falls back to a second one when it fails.
 *
 * Groq's free tier rate-limits by the minute; a meeting that ends during a
 * burst should still get its summary. Each call falls back independently, so
 * a transcript from Groq and an analysis from Gemini is a legitimate result -
 * the stored `provider` field says which did what.
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;
  readonly maxAudioBytes: number;

  constructor(
    private readonly primary: AIProvider,
    private readonly secondary: AIProvider,
  ) {
    this.name = `${primary.name}+${secondary.name}`;
    // A chunk has to fit whichever provider ends up receiving it.
    this.maxAudioBytes = Math.min(primary.maxAudioBytes, secondary.maxAudioBytes);
  }

  private async withFallback<T>(
    operation: string,
    run: (provider: AIProvider) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(this.primary);
    } catch (error) {
      logger.warn(
        { err: error, operation, primary: this.primary.name, fallback: this.secondary.name },
        '[ai] primary provider failed, falling back',
      );
      return run(this.secondary);
    }
  }

  transcribe(audio: AudioInput) {
    return this.withFallback('transcribe', (provider) => provider.transcribe(audio));
  }

  analyze(input: AnalysisInput) {
    return this.withFallback('analyze', (provider) => provider.analyze(input));
  }
}

/**
 * Builds the provider `AI_PROVIDER` asks for (or `name`, for the evaluation
 * script's `--provider` flag). Keys for the configured provider are checked at
 * startup (env.ts); an explicit `name` is checked here.
 */
export function createAIProvider(name: AIProviderName = env.AI_PROVIDER): AIProvider {
  const gemini = env.GEMINI_API_KEY
    ? new GeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL })
    : null;

  switch (name) {
    case 'groq': {
      if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set in server/.env');
      const groq = new GroqProvider({
        apiKey: env.GROQ_API_KEY,
        transcribeModel: env.GROQ_TRANSCRIBE_MODEL,
        chatModel: env.GROQ_CHAT_MODEL,
      });
      return gemini ? new FallbackProvider(groq, gemini) : groq;
    }
    case 'gemini':
      if (!gemini) throw new Error('GEMINI_API_KEY is not set in server/.env');
      return gemini;
    case 'mock':
      return new MockProvider();
  }
}

let provider: AIProvider | null = null;

/** The configured provider, built once. */
export function getAIProvider(): AIProvider {
  provider ??= createAIProvider();
  return provider;
}

/** Test seam: swap in a scripted provider. `null` restores the configured one. */
export function setAIProvider(next: AIProvider | null): void {
  provider = next;
}

export * from './types.js';
