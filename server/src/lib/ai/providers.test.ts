import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini.provider.js';
import { GroqProvider } from './groq.provider.js';
import { FallbackProvider } from './index.js';
import { MockProvider } from './mock.provider.js';
import { ProviderError, type AIProvider, type AudioInput } from './types.js';

/**
 * Vendor adapters, with `fetch` stubbed.
 *
 * No test here reaches the network - the suite must run without accounts and
 * must never spend anybody's quota. What is checked is the contract with each
 * vendor: the request we send, how the reply is read, and how failures are
 * classified.
 */

const SECRET = 'gsk_live_do_not_leak_0123456789';

const AUDIO: AudioInput = {
  data: Buffer.from('fake-audio'),
  mimeType: 'audio/webm',
  filename: 'recording.webm',
  context: {
    title: 'Sync',
    participantNames: ['Ada Lovelace'],
    meetingDate: new Date('2026-09-14'),
  },
};

const ANALYSIS_JSON = JSON.stringify({
  summary: 'They met.',
  keyDecisions: [],
  actionItems: [{ text: 'Do it', assigneeName: 'Ada Lovelace', dueDate: '2026-09-18' }],
});

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const groq = () =>
  new GroqProvider({
    apiKey: SECRET,
    transcribeModel: 'whisper-large-v3',
    chatModel: 'llama-3.3-70b-versatile',
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GroqProvider', () => {
  it('sends the audio to Whisper as multipart, asking for timestamps', async () => {
    const fetchMock = stubFetch(
      json({
        text: 'Hello team.',
        language: 'english',
        segments: [{ start: 0, end: 1.5, text: ' Hello team.' }],
      }),
    );

    const result = await groq().transcribe(AUDIO);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);

    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3');
    expect(form.get('response_format')).toBe('verbose_json');
    // Names as a spelling hint.
    expect(form.get('prompt')).toContain('Ada Lovelace');

    expect(result).toEqual({
      text: 'Hello team.',
      segments: [{ start: 0, end: 1.5, text: 'Hello team.', speaker: null }],
      language: 'english',
      provider: 'groq',
    });
  });

  it('asks Llama for JSON and validates what comes back', async () => {
    const fetchMock = stubFetch(json({ choices: [{ message: { content: ANALYSIS_JSON } }] }));

    const result = await groq().analyze({ ...AUDIO.context, segments: [] });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');

    expect(result.actionItems[0]).toEqual({
      text: 'Do it',
      assigneeName: 'Ada Lovelace',
      dueDate: '2026-09-18',
    });
    expect(result.provider).toBe('groq');
  });

  it('marks a rate limit as worth retrying', async () => {
    stubFetch(new Response('slow down', { status: 429 }));

    const error = await groq()
      .transcribe(AUDIO)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
    expect((error as ProviderError).status).toBe(429);
  });

  it('marks a rejected key as not worth retrying, and never repeats the key', async () => {
    stubFetch(new Response('{"error":{"message":"Invalid API Key"}}', { status: 401 }));

    const error = (await groq()
      .transcribe(AUDIO)
      .catch((caught: unknown) => caught)) as ProviderError;

    expect(error.retryable).toBe(false);
    expect(error.message).toContain('HTTP 401');
    expect(error.message).not.toContain(SECRET);
  });

  it('treats a network failure as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const error = (await groq()
      .transcribe(AUDIO)
      .catch((caught: unknown) => caught)) as ProviderError;
    expect(error.retryable).toBe(true);
  });
});

describe('GeminiProvider', () => {
  const gemini = () => new GeminiProvider({ apiKey: SECRET, model: 'gemini-2.5-flash' });

  it('sends the key in a header, never in the URL', async () => {
    const fetchMock = stubFetch(
      json({ candidates: [{ content: { parts: [{ text: ANALYSIS_JSON }] } }] }),
    );

    await gemini().analyze({ ...AUDIO.context, segments: [] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET);
    expect(url).toContain('gemini-2.5-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
  });

  it('reads timestamped segments from a JSON transcription', async () => {
    stubFetch(
      json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    language: 'en',
                    segments: [{ start: 0, end: 2, text: 'Hi.' }],
                  }),
                },
              ],
            },
          },
        ],
      }),
    );

    const result = await gemini().transcribe(AUDIO);

    expect(result.segments).toEqual([{ start: 0, end: 2, text: 'Hi.', speaker: null }]);
    expect(result.language).toBe('en');
  });

  it('calls the assistant turn "model", as Gemini expects', async () => {
    const fetchMock = stubFetch(json({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }));

    await gemini().complete({
      system: 'sys',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.contents.map((turn: { role: string }) => turn.role)).toEqual(['user', 'model']);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
  });
});

describe('FallbackProvider', () => {
  const failing: AIProvider = {
    name: 'broken',
    maxAudioBytes: 10,
    transcribe: vi.fn().mockRejectedValue(new ProviderError('broken', 'down', 503, true)),
    analyze: vi.fn().mockRejectedValue(new ProviderError('broken', 'down', 503, true)),
  };

  it('uses the second provider when the first fails', async () => {
    const provider = new FallbackProvider(failing, new MockProvider());

    const result = await provider.transcribe(AUDIO);

    expect(result.provider).toBe('mock');
    expect(provider.name).toBe('broken+mock');
  });

  it('sizes chunks for whichever provider is stricter', () => {
    expect(new FallbackProvider(failing, new MockProvider()).maxAudioBytes).toBe(10);
  });
});
