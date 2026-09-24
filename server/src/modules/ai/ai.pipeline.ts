import { Types } from 'mongoose';
import type { AiStatus } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { getAIProvider } from '../../lib/ai/index.js';
import { matchAssignee } from '../../lib/ai/assignee.js';
import { extensionFor, mergeTranscriptions, splitAudio } from '../../lib/ai/audio.js';
import {
  AnalysisFormatError,
  ProviderError,
  type AIProvider,
  type MeetingContext,
  type TranscriptionResult,
} from '../../lib/ai/types.js';
import { logger } from '../../lib/logger.js';
import { Meeting, type MeetingDocument } from '../meetings/meeting.model.js';
import { invalidateMeeting } from '../meetings/meeting.service.js';
import { readLocalRecording } from '../recordings/recording.storage.js';
import { User } from '../users/user.model.js';
import { publishAiStatus, notifySummaryReady } from './ai.notify.js';
import { MeetingInsight } from './insight.model.js';
import { Transcript } from './transcript.model.js';

/**
 * A failure that no amount of retrying will fix: the meeting was deleted, it
 * has no recording, the file is gone. The queue skips its remaining attempts.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/** Whether the queue should spend another attempt on this error. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof PermanentJobError) return false;
  if (error instanceof ProviderError) return error.retryable;
  return true;
}

/**
 * The message stored on the meeting and shown in the UI when a run fails.
 *
 * Written for the person looking at the meeting page, and built only from
 * what is safe to show: a status code, never a request, a key or a stack.
 */
export function describeFailure(error: unknown): string {
  if (error instanceof PermanentJobError) return error.message;

  if (error instanceof ProviderError) {
    if (error.status === 401 || error.status === 403) {
      return 'The AI service rejected the server’s credentials. An administrator needs to check the API key.';
    }
    if (error.status === 429) return 'The AI service is rate-limiting requests. Retry in a minute.';
    if (error.status === 413) return 'The recording is too large for the AI service.';
    return `The AI service could not process the recording${error.status ? ` (HTTP ${error.status})` : ''}. Try again.`;
  }

  if (error instanceof AnalysisFormatError) {
    return 'The AI returned a summary in an unusable format. Try again.';
  }

  return 'Processing failed unexpectedly. Try again.';
}

interface Person {
  id: string;
  name: string;
}

/** Host plus everyone who joined, once each, in joining order. */
async function meetingPeople(meeting: MeetingDocument): Promise<Person[]> {
  const ids = [meeting.hostId, ...meeting.participants.map((participant) => participant.userId)]
    .map((id) => id.toString())
    .filter((id, index, all) => all.indexOf(id) === index);

  const users = await User.find({ _id: { $in: ids } }).select('name');
  const byId = new Map(users.map((user) => [user._id.toString(), user.name]));

  return ids.flatMap((id) => {
    const name = byId.get(id);
    return name ? [{ id, name }] : [];
  });
}

/** Moves the meeting to a pipeline step and tells the team. */
async function setStatus(
  meeting: MeetingDocument,
  status: AiStatus,
  error: string | null = null,
): Promise<void> {
  await Meeting.updateOne({ _id: meeting._id }, { $set: { aiStatus: status, aiError: error } });
  meeting.aiStatus = status;
  await invalidateMeeting(meeting);
  publishAiStatus(
    { id: meeting._id.toString(), teamId: meeting.teamId.toString(), title: meeting.title },
    status,
    error,
  );
}

/** Largest recording the pipeline will download, whatever the source says. */
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;

async function loadAudio(meeting: MeetingDocument): Promise<{ data: Buffer; mimeType: string }> {
  const recording = meeting.recording;
  if (!recording?.url || !recording.publicId) {
    throw new PermanentJobError('This meeting has no recording to process.');
  }

  const mimeType = recording.mimeType ?? 'audio/webm';

  if (recording.storage === 'local') {
    try {
      return { data: await readLocalRecording(recording.publicId), mimeType };
    } catch {
      throw new PermanentJobError(
        'The recording file is no longer on the server. Record the meeting again.',
      );
    }
  }

  // Cloudinary. The URL was checked against our own cloud when it was saved
  // (recording.service.ts), so this can only ever fetch our own asset.
  const response = await fetch(recording.url, { signal: AbortSignal.timeout(120_000) });
  if (response.status === 404) {
    throw new PermanentJobError('The recording is no longer available on Cloudinary.');
  }
  if (!response.ok)
    throw new Error(`Downloading the recording failed with HTTP ${response.status}`);

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES)
    throw new PermanentJobError('The recording is too large to process.');

  return { data: Buffer.from(await response.arrayBuffer()), mimeType };
}

/**
 * Transcribes a recording, splitting it first when it exceeds what the
 * provider accepts in one request.
 */
export async function transcribeRecording(
  provider: AIProvider,
  audio: { data: Buffer; mimeType: string },
  context: MeetingContext,
): Promise<TranscriptionResult> {
  const extension = extensionFor(audio.mimeType);
  const limit = Math.min(provider.maxAudioBytes, env.AI_MAX_FILE_MB * 1024 * 1024);

  const transcribeOne = (data: Buffer) =>
    provider.transcribe({
      data,
      mimeType: audio.mimeType,
      filename: `recording.${extension}`,
      context,
    });

  if (audio.data.length <= limit) return transcribeOne(audio.data);

  const chunks = await splitAudio(audio.data, extension, env.AI_CHUNK_SECONDS);
  logger.info(
    { chunks: chunks.length, bytes: audio.data.length },
    '[ai] recording split for transcription',
  );

  // Sequential, not parallel: a burst of simultaneous uploads is exactly what
  // trips a free-tier rate limit, and the order matters for the timestamps.
  const parts: TranscriptionResult[] = [];
  for (const chunk of chunks) parts.push(await transcribeOne(chunk));

  return mergeTranscriptions(parts, env.AI_CHUNK_SECONDS);
}

/**
 * The `process-meeting` job: recording in, transcript and insight out.
 *
 * Idempotent by construction - transcript and insight are upserted by meeting
 * id - so a retry after a crash halfway through simply overwrites the partial
 * result instead of duplicating it.
 */
export async function processMeeting(
  meetingId: string,
  options: { provider?: AIProvider } = {},
): Promise<void> {
  const provider = options.provider ?? getAIProvider();

  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw new PermanentJobError('The meeting no longer exists.');

  const people = await meetingPeople(meeting);
  const context: MeetingContext = {
    title: meeting.title,
    participantNames: people.map((person) => person.name),
    meetingDate: meeting.startedAt ?? meeting.createdAt,
  };

  // 1-2. Download and transcribe.
  await setStatus(meeting, 'transcribing');
  const audio = await loadAudio(meeting);
  const transcription = await transcribeRecording(provider, audio, context);

  await Transcript.findOneAndUpdate(
    { meetingId: meeting._id },
    {
      $set: {
        text: transcription.text || '(no speech detected)',
        segments: transcription.segments,
        language: transcription.language,
        provider: transcription.provider,
      },
    },
    { upsert: true },
  );

  // 3. Summarise, with strict JSON validation and one repair attempt.
  await setStatus(meeting, 'summarizing');
  const analysis = await provider.analyze({ ...context, segments: transcription.segments });

  // 4. Match each owner to somebody who was actually there.
  const actionItems = analysis.actionItems.map((item) => {
    const match = matchAssignee(item.assigneeName, people);
    return {
      text: item.text,
      // The participant's real name when matched, so "grace" reads "Grace
      // Hopper"; otherwise what the model said, for the host to correct.
      assigneeName: match?.name ?? item.assigneeName,
      assigneeId: match ? new Types.ObjectId(match.id) : null,
      dueDate: item.dueDate,
      status: 'open' as const,
      taskId: null,
    };
  });

  // 5. Save, finish, and tell people.
  await MeetingInsight.findOneAndUpdate(
    { meetingId: meeting._id },
    {
      $set: {
        summary: analysis.summary,
        keyDecisions: analysis.keyDecisions,
        actionItems,
        provider: analysis.provider,
      },
    },
    { upsert: true },
  );

  await setStatus(meeting, 'done');

  await notifySummaryReady(
    { id: meeting._id.toString(), teamId: meeting.teamId.toString(), title: meeting.title },
    people.map((person) => person.id),
  );

  logger.info(
    {
      meetingId,
      provider: analysis.provider,
      segments: transcription.segments.length,
      decisions: analysis.keyDecisions.length,
      actionItems: actionItems.length,
    },
    '[ai] meeting processed',
  );
}

/**
 * Records that a run has failed for good and says why.
 *
 * Called by the queue once no attempts remain. The status goes to `failed`,
 * which is what puts the Retry button in front of the host.
 */
export async function markProcessingFailed(meetingId: string, message: string): Promise<void> {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) return;
  await setStatus(meeting, 'failed', message);
}

/**
 * Between attempts: back to `queued`, so the page says "waiting to retry"
 * rather than claiming to still be transcribing during the backoff.
 */
export async function markAwaitingRetry(meetingId: string): Promise<void> {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) return;
  await setStatus(meeting, 'queued');
}
