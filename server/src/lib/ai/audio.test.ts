import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { extensionFor, ffmpegPath, mergeTranscriptions, splitAudio } from './audio.js';

const run = promisify(execFile);

describe('mergeTranscriptions', () => {
  it('shifts each chunk by where it started and joins the text', () => {
    const merged = mergeTranscriptions(
      [
        {
          text: 'First.',
          segments: [{ start: 1, end: 3, text: 'First.', speaker: null }],
          language: 'en',
          provider: 'groq',
        },
        {
          text: 'Second.',
          segments: [{ start: 2, end: 4, text: 'Second.', speaker: null }],
          language: null,
          provider: 'groq',
        },
      ],
      600,
    );

    expect(merged.text).toBe('First. Second.');
    expect(merged.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [1, 3],
      [602, 604],
    ]);
    expect(merged.language).toBe('en');
    expect(merged.provider).toBe('groq');
  });

  it('records a mix of providers when a fallback served some chunks', () => {
    const part = (provider: string) => ({ text: 'x', segments: [], language: null, provider });
    expect(mergeTranscriptions([part('groq'), part('gemini')], 600).provider).toBe('groq+gemini');
  });
});

describe('extensionFor', () => {
  it.each([
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/ogg', 'ogg'],
    ['audio/mp4', 'm4a'],
    ['audio/mpeg', 'mp3'],
  ])('%s -> %s', (mime, extension) => {
    expect(extensionFor(mime)).toBe(extension);
  });
});

describe('splitAudio (real ffmpeg)', () => {
  it('cuts a recording into fixed-length chunks without re-encoding', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'intellmeet-audio-test-'));

    try {
      // 25 seconds of tone, encoded the way a browser's MediaRecorder would.
      const source = path.join(dir, 'tone.webm');
      await run(ffmpegPath(), [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=25',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        source,
      ]);

      const chunks = await splitAudio(await readFile(source), 'webm', 10);

      // 10s + 10s + 5s.
      expect(chunks).toHaveLength(3);
      for (const chunk of chunks) expect(chunk.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
