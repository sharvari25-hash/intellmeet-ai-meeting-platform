import { AI_PROVIDERS, env } from '../../config/env.js';
import { logger } from '../logger.js';
import { GeminiProvider } from './gemini.provider.js';
import { GroqProvider } from './groq.provider.js';
import { MockProvider } from './mock.provider.js';
import { ProviderError, type AIProvider, type AnalysisInput, type AudioInput } from './types.js';

export type AIProviderName = (typeof AI_PROVIDERS)[number];

/**
 * Whether another model of the same vendor could succeed where one failed.
 *
 * Yes for what is particular to a model: overloaded or rate-limited (429,
 * 5xx), out of its daily quota, withdrawn or not available to this key (403,
 * 404), a network failure, or output that failed validation twice. No for a
 * request the vendor rejected as malformed (400) or a key it does not accept
 * (401): every model would answer the same, so trying them all only spends
 * quota.
 */
export function modelMightHelp(error: unknown): boolean {
  if (!(error instanceof ProviderError)) return true;
  return error.status !== 400 && error.status !== 401;
}

/**
 * Tries a primary provider and falls back to a second one when it fails.
 *
 * Groq's free tier rate-limits by the minute; a meeting that ends during a
 * burst should still get its summary. Each call falls back independently, so
 * a transcript from Groq and an analysis from Gemini is a legitimate result -
 * the stored `provider` field says which did what. Between two vendors any
 * failure is worth a try; between two models of one vendor, `shouldFallBack`
 * narrows it (see modelMightHelp).
 */
export class FallbackProvider implements AIProvider {
  readonly name: string;
  readonly maxAudioBytes: number;

  constructor(
    private readonly primary: AIProvider,
    private readonly secondary: AIProvider,
    private readonly shouldFallBack: (error: unknown) => boolean = () => true,
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
      if (!this.shouldFallBack(error)) throw error;
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
  const gemini = env.GEMINI_API_KEY ? createGemini(env.GEMINI_API_KEY) : null;

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

/**
 * GEMINI_MODEL, then each of GEMINI_FALLBACK_MODELS in turn.
 *
 * Free-tier capacity is per model: 20 requests a day each (measured at Phase
 * 11), and load that comes and goes (the newest models answered 503 for
 * minutes while older ones answered at once). A chain of models multiplies
 * the daily allowance and rides out one model's overload.
 */
export function createGemini(
  apiKey: string,
  models: { model: string; fallbacks: string[] } = {
    model: env.GEMINI_MODEL,
    fallbacks: env.GEMINI_FALLBACK_MODELS,
  },
): AIProvider {
  const names = [models.model, ...models.fallbacks].filter(
    (name, index, all) => all.indexOf(name) === index,
  );
  const chain = names.map((model) => new GeminiProvider({ apiKey, model }) as AIProvider);
  // a, b, c -> a+(b+c): the first model first, each next only on a failure
  // another model could fix.
  return chain.reduceRight((next, current) => new FallbackProvider(current, next, modelMightHelp));
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
