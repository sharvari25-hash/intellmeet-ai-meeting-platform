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
import { destroyCloudinaryRecordings, RECORDING_PUBLIC_ID } from './recording.cloudinary.js';
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

/** Deletes a recording that no meeting will point at, wherever it is stored. */
async function discardRecording(
  meetingId: string,
  recording: { storage?: string | null; publicId?: string | null },
): Promise<void> {
  if (!recording.publicId) return;
  if (recording.storage === 'local') await deleteLocalRecording(recording.publicId);
  if (recording.storage === 'cloudinary') {
    await destroyCloudinaryRecordings([{ meetingId, publicId: recording.publicId }]);
  }
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

  const meetingId = meeting._id.toString();

  if (!updated) {
    // Nothing was attached, so the file just stored must not linger - unless
    // it is the very one already attached (the same registration sent twice).
    if (recording.publicId !== previous?.publicId) await discardRecording(meetingId, recording);
    throw AppError.conflict('This meeting’s recording is already being processed');
  }

  // A second recording of the same meeting replaces the first.
  if (previous?.publicId && previous.publicId !== recording.publicId) {
    await discardRecording(meetingId, previous);
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

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The recording's delivery URL, if `raw` is exactly that and nothing else.
 *
 * The worker downloads this URL, so it is pinned to more than our cloud:
 * to the plain `video/upload` URL of the very asset named by `publicId`
 * (with the optional version segment Cloudinary adds, and a file extension).
 * That rules out another host (server-side request forgery), another asset
 * in our cloud, transformations, and `fetch` URLs, with which Cloudinary
 * would download any address on the internet for us. The URL is parsed first,
 * so dot segments and percent-encoded tricks are resolved before the check,
 * and the normalised form is what gets stored.
 */
export function ownRecordingUrl(raw: string, cloudName: string, publicId: string): string | null {
  if (!RECORDING_PUBLIC_ID.test(publicId)) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const plain =
    url.protocol === 'https:' &&
    url.hostname === 'res.cloudinary.com' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '';
  if (!plain) return null;

  const delivery = new RegExp(
    `^/${escapeRegExp(cloudName)}/video/upload/(?:v\\d+/)?${escapeRegExp(publicId)}\\.[a-z0-9]{2,5}$`,
  );
  return delivery.test(url.pathname) ? url.href : null;
}

/**
 * Registers a recording the browser uploaded to Cloudinary.
 *
 * The URL is later *downloaded by the server*, so it must be this app's own
 * upload (`ownRecordingUrl`). Accepting any URL would let a host point the
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

  if (!RECORDING_PUBLIC_ID.test(input.publicId)) {
    throw AppError.badRequest('The recording must be in the recordings folder');
  }
  const url = ownRecordingUrl(input.url, config.cloudName, input.publicId);
  if (!url) {
    throw AppError.badRequest(
      'The recording URL must be this recording’s own address on this app’s Cloudinary account',
    );
  }

  // Deleting a meeting deletes its recording from Cloudinary, so a recording
  // may belong to one meeting only. Otherwise a host could register another
  // meeting's recording on their own meeting, then delete it by deleting theirs.
  const claimed = await Meeting.exists({
    _id: { $ne: meeting._id },
    'recording.publicId': input.publicId,
  });
  if (claimed) throw AppError.conflict('This recording belongs to another meeting');

  return attachAndQueue(meeting, userId, {
    url,
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
