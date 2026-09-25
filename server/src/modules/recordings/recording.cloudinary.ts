import { destroyAsset, getCloudinaryConfig } from '../../config/cloudinary.js';
import { logger } from '../../lib/logger.js';

/**
 * The public ids Cloudinary gives uploads signed for the recordings folder:
 * the folder, then its own random name. Nothing that could leave the folder
 * or smuggle URL syntax (`..`, `%`, `?`, `#`). Checked when a recording is
 * registered, and again before one is deleted.
 */
export const RECORDING_PUBLIC_ID = /^intellmeet\/recordings\/[A-Za-z0-9_-]+$/;

/** How many deletions are in flight at once, for a cleanup that removes many. */
const BATCH = 10;

export interface CloudinaryRecording {
  meetingId: string;
  publicId: string;
}

/**
 * Deletes meetings' recordings from Cloudinary. Never throws.
 *
 * Called when a meeting is deleted (by its host, the demo cleanup, or with a
 * guest account) and when a new recording replaces or duplicates one, so a
 * recording does not outlive its meeting: it would stay playable by anyone
 * holding its URL, and keep using the free plan's storage.
 *
 * A failure is logged and otherwise ignored. Deleting the meeting is what the
 * person asked for, and it must not fail because Cloudinary did; the log line
 * names the asset so it can be removed by hand.
 *
 * Only public ids of the recordings folder's own shape are ever deleted,
 * whatever the database says, so a damaged record can never take an avatar
 * (or anything else in the account) with it.
 */
export async function destroyCloudinaryRecordings(
  recordings: CloudinaryRecording[],
): Promise<number> {
  const ours = recordings.filter((recording) => RECORDING_PUBLIC_ID.test(recording.publicId));
  if (ours.length === 0) return 0;

  const config = getCloudinaryConfig();
  if (!config) {
    logger.warn(
      { publicIds: ours.map((recording) => recording.publicId) },
      '[recordings] Cloudinary is not configured; these recordings stay on Cloudinary',
    );
    return 0;
  }

  let destroyed = 0;
  for (let start = 0; start < ours.length; start += BATCH) {
    const batch = ours.slice(start, start + BATCH);
    const outcomes = await Promise.allSettled(
      batch.map((recording) => destroyAsset(config, recording.publicId, 'video')),
    );

    outcomes.forEach((outcome, index) => {
      const { meetingId, publicId } = batch[index] as CloudinaryRecording;

      if (outcome.status === 'fulfilled' && outcome.value.result === 'ok') {
        destroyed += 1;
        return;
      }
      // Already gone is the outcome we wanted.
      if (outcome.status === 'fulfilled' && outcome.value.result === 'not found') return;

      // Only the message and status: the SDK's error objects are not ours to
      // vouch for, and a log line must never carry a credential.
      const reason =
        outcome.status === 'rejected'
          ? describeError(outcome.reason)
          : { result: outcome.value.result };
      logger.error(
        { meetingId, publicId, ...reason },
        '[recordings] could not delete a recording from Cloudinary; remove it by hand',
      );
    });
  }

  return destroyed;
}

function describeError(error: unknown): { message: string; httpCode?: number } {
  if (error && typeof error === 'object') {
    // The SDK rejects with `{ error: { message, http_code } }` or an Error.
    const inner =
      'error' in error && error.error && typeof error.error === 'object' ? error.error : error;
    const message =
      'message' in inner && typeof inner.message === 'string' ? inner.message : 'unknown error';
    const httpCode =
      'http_code' in inner && typeof inner.http_code === 'number' ? inner.http_code : undefined;
    return { message, httpCode };
  }
  return { message: String(error) };
}
