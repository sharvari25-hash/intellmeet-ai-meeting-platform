import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * Local-disk storage for recordings, used when Cloudinary is not configured.
 *
 * This is what lets the recording -> transcript -> summary flow run on a
 * development machine with no third-party accounts. It is not a production
 * store: Render's disk is wiped on every deploy and restart, which is fine for
 * a job that reads the file seconds after upload but not for playing it back
 * next week. Production sets the Cloudinary variables and never touches this.
 */

/** Server package root: this file is at <pkg>/{src,dist}/modules/recordings/. */
const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../../..');

export function recordingsDir(): string {
  return path.resolve(PACKAGE_ROOT, env.RECORDINGS_DIR);
}

/**
 * The only file names this module will ever read or delete.
 *
 * The name is stored in the database and comes back into `path.join` later;
 * pinning it to `<meetingId>-<timestamp>.<ext>` means a tampered value can
 * never walk out of the directory (`../../.env`).
 */
const FILE_NAME = /^[a-f0-9]{24}-\d{13}\.(webm|ogg|m4a|mp3|wav)$/;

function filePath(fileName: string): string {
  if (!FILE_NAME.test(fileName)) {
    throw AppError.badRequest('Invalid recording file name');
  }
  return path.join(recordingsDir(), fileName);
}

export async function saveLocalRecording(
  meetingId: string,
  data: Buffer,
  extension: string,
): Promise<string> {
  const fileName = `${meetingId}-${Date.now()}.${extension}`;
  await mkdir(recordingsDir(), { recursive: true });
  await writeFile(filePath(fileName), data);
  return fileName;
}

export async function readLocalRecording(fileName: string): Promise<Buffer> {
  try {
    return await readFile(filePath(fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw AppError.notFound('The recording file is no longer on this server');
    }
    throw error;
  }
}

export function localRecordingPath(fileName: string): string {
  return filePath(fileName);
}

/** Best effort: a file that is already gone is the outcome we wanted anyway. */
export async function deleteLocalRecording(fileName: string): Promise<void> {
  if (!FILE_NAME.test(fileName)) return;
  await rm(filePath(fileName), { force: true });
}
