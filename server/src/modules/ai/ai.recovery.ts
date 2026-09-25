import { getMeetingQueue, type MeetingQueue } from '../../jobs/meetingQueue.js';
import { logger } from '../../lib/logger.js';
import { Meeting } from '../meetings/meeting.model.js';
import { invalidateMeeting } from '../meetings/meeting.service.js';
import { publishAiStatus } from './ai.notify.js';

/** The pipeline steps a meeting sits in while a queue job owns it. */
const IN_PROGRESS = ['queued', 'transcribing', 'summarizing'] as const;

/**
 * How long a run must have gone without a status change before its job is
 * looked for. Every step of a run changes the status (and so `updatedAt`), and
 * a meeting is marked `queued` moments before its job is added, so this only
 * has to outlast that gap; the queue check below is what decides.
 */
export const LOST_RUN_AFTER_MS = 10 * 60 * 1000;

/** Shown on the meeting page, beside the host's Retry button. */
export const LOST_RUN_MESSAGE =
  'Processing was interrupted (the job queue restarted). Press Retry to run it again.';

/**
 * Fails AI runs whose queue job no longer exists, so the host can retry them.
 *
 * Production's Redis (Render Key Value on the free plan) keeps nothing on
 * disk: if it restarts, every waiting and running job goes with it. The
 * meetings those jobs belonged to would then say "Transcribing..." for ever,
 * and Retry is only offered once a run has failed. A process restart is not
 * the problem (BullMQ hands a job whose worker died to the next worker); a
 * Redis restart is.
 *
 * A run counts as lost when it has been in progress, unchanged, for
 * `LOST_RUN_AFTER_MS` and the queue holds no job for its meeting. Two rules
 * keep this from failing a run that is actually alive:
 *
 * - **The queue is asked, not guessed.** If it cannot be read, this rejects
 *   and fails nothing: "unknown" must never be read as "lost".
 * - **The write is conditional** on the status and `updatedAt` read at the
 *   start. A job that moved the run on meanwhile (finished, failed, started
 *   its next attempt) changed both, so the write finds nothing to change.
 */
export async function failLostAiRuns(
  options: { now?: Date; queue?: MeetingQueue } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const queue = options.queue ?? getMeetingQueue();
  const cutoff = new Date(now.getTime() - LOST_RUN_AFTER_MS);

  const stale = await Meeting.find({
    aiStatus: { $in: IN_PROGRESS },
    updatedAt: { $lt: cutoff },
  }).select('_id teamId title roomCode aiStatus updatedAt');

  // The usual case: nothing in progress for long, and Redis is not touched.
  if (stale.length === 0) return 0;

  const pending = await queue.pendingMeetingIds();
  let failed = 0;

  for (const meeting of stale) {
    const meetingId = meeting._id.toString();
    if (pending.has(meetingId)) continue;

    const update = await Meeting.updateOne(
      { _id: meeting._id, aiStatus: meeting.aiStatus, updatedAt: meeting.updatedAt },
      { $set: { aiStatus: 'failed', aiError: LOST_RUN_MESSAGE } },
    );
    if (update.modifiedCount === 0) continue;

    failed += 1;
    await invalidateMeeting(meeting);
    publishAiStatus(
      { id: meetingId, teamId: meeting.teamId.toString(), title: meeting.title },
      'failed',
      LOST_RUN_MESSAGE,
    );
    logger.warn(
      { meetingId, title: meeting.title, wasStatus: meeting.aiStatus },
      '[ai] marked a run failed: its queue job was lost',
    );
  }

  return failed;
}
