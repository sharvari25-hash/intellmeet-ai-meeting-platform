import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { TranscriptSegment } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import type { TranscriptionResult } from './types.js';

const run = promisify(execFile);

/**
 * The ffmpeg binary: `FFMPEG_PATH` if set, else the one bundled by
 * `@ffmpeg-installer/ffmpeg`.
 *
 * That package ships the binary as a per-platform optional dependency with no
 * install script - unlike `ffmpeg-static`, which downloads it in a postinstall
 * step that npm's install-script policy blocks on this project. Resolved
 * lazily, so a platform without a bundled build only fails when a recording
 * actually needs splitting.
 */
export function ffmpegPath(): string {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  const require = createRequire(import.meta.url);
  return (require('@ffmpeg-installer/ffmpeg') as { path: string }).path;
}

/**
 * Splits audio into fixed-length chunks without re-encoding.
 *
 * `-c copy` cuts on packet boundaries (20 ms for Opus), so it is fast and
 * lossless, and chunk N starts within a packet of `N * chunkSeconds` - close
 * enough to offset the timestamps from each chunk by that amount.
 */
export async function splitAudio(
  data: Buffer,
  extension: string,
  chunkSeconds: number,
): Promise<Buffer[]> {
  const dir = await mkdtemp(path.join(tmpdir(), 'intellmeet-split-'));

  try {
    const input = path.join(dir, `input.${extension}`);
    await writeFile(input, data);

    await run(
      ffmpegPath(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        input,
        '-f',
        'segment',
        '-segment_time',
        String(chunkSeconds),
        '-c',
        'copy',
        path.join(dir, `chunk-%03d.${extension}`),
      ],
      { timeout: 120_000 },
    );

    const chunks = (await readdir(dir)).filter((name) => name.startsWith('chunk-')).sort();
    return Promise.all(chunks.map((name) => readFile(path.join(dir, name))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Stitches per-chunk transcripts back into one, shifting each chunk's
 * timestamps by where that chunk started in the full recording.
 */
export function mergeTranscriptions(
  parts: TranscriptionResult[],
  chunkSeconds: number,
): Omit<TranscriptionResult, 'provider'> & { provider: string } {
  const segments: TranscriptSegment[] = parts.flatMap((part, index) =>
    part.segments.map((segment) => ({
      ...segment,
      start: segment.start + index * chunkSeconds,
      end: segment.end + index * chunkSeconds,
    })),
  );

  return {
    text: parts
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join(' '),
    segments,
    language: parts.find((part) => part.language)?.language ?? null,
    provider: [...new Set(parts.map((part) => part.provider))].join('+'),
  };
}

/** File extension for a recording's MIME type, which ffmpeg uses to pick the muxer. */
export function extensionFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac'))
    return 'm4a';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}
