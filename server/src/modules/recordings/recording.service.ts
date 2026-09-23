import type {
  Meeting as MeetingDto,
  RecordingUploadTarget,
  SaveRecordingInput,
} from '@intellmeet/shared';
import { getCloudinaryConfig } from '../../config/cloudinary.js';
import { env } from '../../config/env.js';
import { extensionFor } from '../../lib/ai/audio.js';
import { AppError } from '../../lib/errors.js';
import { getMeetingQueue } from '../../jobs/meetingQueue.js';
import { publishAiStatus } from '../ai/ai.notify.js';
import { Meeting, type MeetingDocument } from '../meetings/meeting.model.js';
import {
  getMeetingForHost,
  getMeetingForMember,
  invalidateMeeting,
  toMeetingDto,
} from '../meetings/meeting.service.js';
import { createUploadSignature } from '../uploads/upload.service.js';
import {
  deleteLocalRecording,
  localRecordingPath,
  saveLocalRecording,
} from './recording.storage.js';

/** Pipeline steps during which a new recording must not replace the current one. */
const IN_PROGRESS = ['queued', 'transcribing', 'summarizing'] as const;

/** Container formats a browser's MediaRecorder produces for audio. */
const ACCEPTED_TYPES = [
  'audio/webm',
  'video/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
];

export function isAcceptedRecordingType(contentType: string | undefined): boolean {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return ACCEPTED_TYPES.includes(base);
}

/** Recording only makes sense once a meeting has actually happened. */
function assertRecordable(meeting: MeetingDocument): void {
  if (meeting.status === 'scheduled') {
    throw AppError.conflict('A meeting can only be recorded once it has started');
  }
}

/**
 * Tells the host's browser where to send a finished recording. Cloudinary when
 * configured; otherwise straight to this API.
 */
export async function getUploadTarget(
  meetingId: string,
  userId: string,
): Promise<RecordingUploadTarget> {
  const meeting = await getMeetingForHost(meetingId, userId);
  assertRecordable(meeting);

  if (getCloudinaryConfig()) {
    return { kind: 'cloudinary', signature: createUploadSignature('recording', userId) };
  }

  return {
    kind: 'server',
    uploadPath: `/meetings/${meetingId}/recording/file`,
    maxBytes: env.MAX_RECORDING_MB * 1024 * 1024,
  };
}

interface RecordingFields {
  url: string;
  publicId: string;
  durationSec: number;
  storage: 'cloudinary' | 'local';
  mimeType: string;
}

/**
 * Attaches a recording and queues it for processing, atomically.
 *
 * The status check and the update are one `findOneAndUpdate`, so two uploads
 * racing (a double-click, a retried request) cannot both pass the check and
 * enqueue the meeting twice. Only one wins; the other gets a 409.
 */
async function attachAndQueue(
  meeting: MeetingDocument,
  userId: string,
  recording: RecordingFields,
): Promise<MeetingDto> {
  const previous = meeting.recording;

  const updated = await Meeting.findOneAndUpdate(
    { _id: meeting._id, aiStatus: { $nin: IN_PROGRESS } },
    {
      $set: {
        recording: { ...recording, status: 'ready' },
        aiStatus: 'queued',
        aiError: null,
      },
    },
    { new: true },
  );

  if (!updated) {
    // Nothing was attached, so the file just written must not linger.
    if (recording.storage === 'local') await deleteLocalRecording(recording.publicId);
    throw AppError.conflict('This meeting’s recording is already being processed');
  }

  // A second recording of the same meeting replaces the first.
  if (
    previous?.storage === 'local' &&
    previous.publicId &&
    previous.publicId !== recording.publicId
  ) {
    await deleteLocalRecording(previous.publicId);
  }

  await invalidateMeeting(updated);
  await getMeetingQueue().enqueue(updated._id.toString());
  publishAiStatus(
    { id: updated._id.toString(), teamId: updated.teamId.toString(), title: updated.title },
    'queued',
    null,
  );

  return toMeetingDto(updated, userId);
}

/**
 * Registers a recording the browser uploaded to Cloudinary.
 *
 * The URL is later *downloaded by the server*, so it is pinned to our own
 * cloud and recordings folder. Accepting any URL would let a host point the
 * job at an internal address - a server-side request forgery.
 */
export async function saveCloudinaryRecording(
  meetingId: string,
  userId: string,
  input: SaveRecordingInput,
): Promise<MeetingDto> {
  const config = getCloudinaryConfig();
  if (!config) {
    throw AppError.unavailable('Cloudinary is not configured; upload the file to the API instead');
  }

  const meeting = await getMeetingForHost(meetingId, userId);
  assertRecordable(meeting);

  const expectedPrefix = `https://res.cloudinary.com/${config.cloudName}/`;
  if (!input.url.startsWith(expectedPrefix)) {
    throw AppError.badRequest('The recording URL must point at this app’s Cloudinary account');
  }
  if (!input.publicId.startsWith('intellmeet/recordings/')) {
    throw AppError.badRequest('The recording must be in the recordings folder');
  }

  return attachAndQueue(meeting, userId, {
    url: input.url,
    publicId: input.publicId,
    durationSec: Math.round(input.durationSec),
    storage: 'cloudinary',
    mimeType: 'audio/webm',
  });
}

/** Stores a recording uploaded straight to the API (no Cloudinary). */
export async function saveUploadedRecording(
  meetingId: string,
  userId: string,
  file: { data: Buffer; contentType: string; durationSec: number },
): Promise<MeetingDto> {
  const meeting = await getMeetingForHost(meetingId, userId);
  assertRecordable(meeting);

  if (file.data.length === 0) throw AppError.badRequest('The recording is empty');

  const mimeType = (file.contentType.split(';')[0] ?? 'audio/webm').trim().toLowerCase();
  const fileName = await saveLocalRecording(meetingId, file.data, extensionFor(mimeType));

  return attachAndQueue(meeting, userId, {
    // Where the audio can be fetched back from (with a bearer token).
    url: `/api/meetings/${meetingId}/recording/audio`,
    publicId: fileName,
    durationSec: Math.round(file.durationSec),
    storage: 'local',
    mimeType,
  });
}

/** Re-queues a failed run. Host only, and only from `failed`. */
export async function retryProcessing(meetingId: string, userId: string): Promise<MeetingDto> {
  const meeting = await getMeetingForHost(meetingId, userId);
  if (!meeting.recording?.url) throw AppError.conflict('This meeting has no recording to process');

  const updated = await Meeting.findOneAndUpdate(
    { _id: meeting._id, aiStatus: 'failed' },
    { $set: { aiStatus: 'queued', aiError: null } },
    { new: true },
  );
  if (!updated) throw AppError.conflict('Only a failed run can be retried');

  await invalidateMeeting(updated);
  await getMeetingQueue().enqueue(updated._id.toString());
  publishAiStatus(
    { id: updated._id.toString(), teamId: updated.teamId.toString(), title: updated.title },
    'queued',
    null,
  );

  return toMeetingDto(updated, userId);
}

export type RecordingAudio =
  { kind: 'local'; path: string; mimeType: string } | { kind: 'remote'; url: string };

/** Where a team member can get the audio. Membership is checked first. */
export async function getRecordingAudio(
  meetingId: string,
  userId: string,
): Promise<RecordingAudio> {
  const meeting = await getMeetingForMember(meetingId, userId);
  const recording = meeting.recording;
  if (!recording?.url || !recording.publicId)
    throw AppError.notFound('This meeting has no recording');

  if (recording.storage === 'local') {
    return {
      kind: 'local',
      path: localRecordingPath(recording.publicId),
      mimeType: recording.mimeType ?? 'audio/webm',
    };
  }

  return { kind: 'remote', url: recording.url };
}
