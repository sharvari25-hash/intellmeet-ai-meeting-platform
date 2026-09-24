import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider, geminiAudioMimeType, toSeconds } from './gemini.provider.js';
import { setProviderRetryDelays } from './http.js';
import { GroqProvider } from './groq.provider.js';
import { FallbackProvider, createGemini, modelMightHelp } from './index.js';
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

// One request per call here: the in-call retry has its own tests (http.test.ts).
beforeEach(() => setProviderRetryDelays([]));

afterEach(() => {
  setProviderRetryDelays(null);
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
  const gemini = () => new GeminiProvider({ apiKey: SECRET, model: 'gemini-3.5-flash' });

  /** A generateContent reply whose text is `text`. */
  const reply = (text: string) => json({ candidates: [{ content: { parts: [{ text }] } }] });

  const sentBody = (fetchMock: ReturnType<typeof stubFetch>) =>
    JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);

  it('sends the key in a header, never in the URL', async () => {
    const fetchMock = stubFetch(reply(ANALYSIS_JSON));

    await gemini().analyze({ ...AUDIO.context, segments: [] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(SECRET);
    expect(url).toContain('gemini-3.5-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(SECRET);
  });

  it('declares the browser’s recording as a type Gemini accepts', async () => {
    const segments = JSON.stringify({ segments: [] });
    const fetchMock = stubFetch(reply(segments), reply(segments));

    await gemini().transcribe({ ...AUDIO, mimeType: 'audio/webm;codecs=opus' });
    await gemini().transcribe({ ...AUDIO, mimeType: 'audio/mp4' });

    const declared = fetchMock.mock.calls.map(
      ([, init]) =>
        JSON.parse((init as RequestInit).body as string).contents[0].parts[0].inlineData.mimeType,
    );
    expect(declared).toEqual(['audio/webm', 'audio/m4a']);
  });

  it('leaves temperature at the model default, as Google advises for Gemini 3', async () => {
    const fetchMock = stubFetch(reply(JSON.stringify({ segments: [] })), reply(ANALYSIS_JSON));

    await gemini().transcribe(AUDIO);
    await gemini().analyze({ ...AUDIO.context, segments: [] });

    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
    }
  });

  it('accepts clock-style timestamps, a fenced reply and a bare segment list', async () => {
    stubFetch(
      reply(
        '```json\n' +
          JSON.stringify({
            language: 'en',
            segments: [{ start: '00:05', end: '0:07.5', text: ' Hi. ' }],
          }) +
          '\n```',
      ),
      reply(JSON.stringify([{ start: '1:01:15', end: '3676s', text: 'Bye.' }])),
    );

    const first = await gemini().transcribe(AUDIO);
    const second = await gemini().transcribe(AUDIO);

    expect(first.segments).toEqual([{ start: 5, end: 7.5, text: 'Hi.', speaker: null }]);
    expect(second.segments).toEqual([{ start: 3675, end: 3676, text: 'Bye.', speaker: null }]);
    expect(second.language).toBeNull();
  });

  it('reads timestamps in every form a model writes them, and nothing else', () => {
    expect(toSeconds(12)).toBe(12);
    expect(toSeconds('12.5')).toBe(12.5);
    expect(toSeconds('12.5s')).toBe(12.5);
    expect(toSeconds('02:03')).toBe(123);
    expect(toSeconds('1:02:03.5')).toBe(3723.5);
    expect(toSeconds('soon')).toBeNull();
    expect(toSeconds(Number.NaN)).toBeNull();
    expect(toSeconds(null)).toBeNull();
  });

  it('names audio types the way Gemini lists them', () => {
    expect(geminiAudioMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(geminiAudioMimeType('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(geminiAudioMimeType('audio/mp4')).toBe('audio/m4a');
    expect(geminiAudioMimeType('audio/x-wav')).toBe('audio/wav');
    expect(geminiAudioMimeType('')).toBe('audio/webm');
  });

  it('retries a transcript it cannot read rather than storing it', async () => {
    const fetchMock = stubFetch(reply('Sorry, I cannot help with that.'));

    const error = (await gemini()
      .transcribe(AUDIO)
      .catch((caught: unknown) => caught)) as ProviderError;

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.retryable).toBe(true);
    expect(sentBody(fetchMock).contents[0].parts[1].text).toContain('seconds from the beginning');
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

  describe('a chain of Gemini models', () => {
    const chain = () =>
      createGemini(SECRET, {
        model: 'gemini-3.5-flash',
        fallbacks: ['gemini-3.6-flash', 'gemini-3.7-flash'],
      });
    const answer = () => json({ candidates: [{ content: { parts: [{ text: ANALYSIS_JSON }] } }] });
    const modelsCalled = (fetchMock: ReturnType<typeof stubFetch>) =>
      fetchMock.mock.calls.map(([url]) => /models\/([^:]+):/.exec(String(url))?.[1]);

    it('moves down the chain past an overloaded model and one out of its daily quota', async () => {
      const fetchMock = stubFetch(
        new Response('{"error":{"status":"UNAVAILABLE"}}', { status: 503 }),
        new Response('{"error":{"details":[{"retryDelay":"57s"}]}}', { status: 429 }),
        answer(),
      );

      const result = await chain().analyze({ ...AUDIO.context, segments: [] });

      expect(chain().name).toBe(
        'gemini:gemini-3.5-flash+gemini:gemini-3.6-flash+gemini:gemini-3.7-flash',
      );
      expect(result.provider).toBe('gemini:gemini-3.7-flash');
      expect(modelsCalled(fetchMock)).toEqual([
        'gemini-3.5-flash',
        'gemini-3.6-flash',
        'gemini-3.7-flash',
      ]);
    });

    it('moves on from a model that has been withdrawn (404)', async () => {
      const fetchMock = stubFetch(new Response('not found', { status: 404 }), answer());

      await chain().analyze({ ...AUDIO.context, segments: [] });

      expect(modelsCalled(fetchMock)).toEqual(['gemini-3.5-flash', 'gemini-3.6-flash']);
    });

    it('stops at a malformed request or a rejected key: every model would say the same', async () => {
      for (const status of [400, 401]) {
        const fetchMock = stubFetch(new Response('no', { status }), answer());

        const error = (await chain()
          .analyze({ ...AUDIO.context, segments: [] })
          .catch((caught: unknown) => caught)) as ProviderError;

        expect(error.status).toBe(status);
        expect(modelsCalled(fetchMock)).toEqual(['gemini-3.5-flash']);
      }
    });

    it('is a single model when no other is configured, and never lists one twice', () => {
      expect(createGemini(SECRET, { model: 'gemini-3.5-flash', fallbacks: [] }).name).toBe(
        'gemini:gemini-3.5-flash',
      );
      expect(
        createGemini(SECRET, {
          model: 'gemini-3.5-flash',
          fallbacks: ['gemini-3.5-flash', 'gemini-3.6-flash'],
        }).name,
      ).toBe('gemini:gemini-3.5-flash+gemini:gemini-3.6-flash');
    });
  });

  it('tells model-specific failures from ones no other model would fix', () => {
    expect(modelMightHelp(new ProviderError('g', 'x', 503, true))).toBe(true);
    expect(modelMightHelp(new ProviderError('g', 'x', 429, true))).toBe(true);
    expect(modelMightHelp(new ProviderError('g', 'x', 404, false))).toBe(true);
    expect(modelMightHelp(new ProviderError('g', 'x', null, true))).toBe(true);
    expect(modelMightHelp(new Error('invalid output twice'))).toBe(true);
    expect(modelMightHelp(new ProviderError('g', 'x', 400, false))).toBe(false);
    expect(modelMightHelp(new ProviderError('g', 'x', 401, false))).toBe(false);
  });
});
