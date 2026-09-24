import { z } from 'zod';
import {
  meetingIntelligenceSchema,
  meetingSchema,
  recordingUploadTargetSchema,
  type Meeting,
  type MeetingIntelligence,
  type RecordingUploadTarget,
} from '@intellmeet/shared';
import { api } from '@/lib/apiClient';

const meetingResponseSchema = z.object({ meeting: meetingSchema });

export const aiKeys = {
  intelligence: (meetingId: string) => ['meetings', meetingId, 'intelligence'] as const,
};

export function getMeetingIntelligence(meetingId: string): Promise<MeetingIntelligence> {
  return api(`/meetings/${meetingId}/intelligence`, meetingIntelligenceSchema);
}

export function retryAiProcessing(meetingId: string): Promise<Meeting> {
  return api(`/meetings/${meetingId}/ai/retry`, meetingResponseSchema, { method: 'POST' }).then(
    (result) => result.meeting,
  );
}

function getUploadTarget(meetingId: string): Promise<RecordingUploadTarget> {
  return api(`/meetings/${meetingId}/recording/upload-target`, recordingUploadTargetSchema);
}

/** What Cloudinary answers a successful upload with (the parts we use). */
const cloudinaryUploadSchema = z.object({ secure_url: z.string(), public_id: z.string() });

/**
 * Uploads a finished recording and registers it, which queues the AI job.
 *
 * The server says where the file goes. With Cloudinary configured, the browser
 * posts it there directly using a signature the API minted - the audio never
 * passes through our server - and then tells the API where it landed. Without
 * Cloudinary, the file goes straight to the API.
 */
export async function uploadRecording(
  meetingId: string,
  recording: { blob: Blob; durationSec: number },
): Promise<Meeting> {
  const target = await getUploadTarget(meetingId);

  if (target.kind === 'server') {
    if (recording.blob.size > target.maxBytes) {
      throw new Error('This recording is larger than the server accepts.');
    }

    const result = await api(
      `/meetings/${meetingId}/recording/file?durationSec=${recording.durationSec}`,
      meetingResponseSchema,
      { method: 'PUT', body: recording.blob },
    );
    return result.meeting;
  }

  const { signature } = target;
  const form = new FormData();
  form.append('file', recording.blob, 'recording');
  form.append('api_key', signature.apiKey);
  form.append('timestamp', String(signature.timestamp));
  form.append('signature', signature.signature);
  form.append('folder', signature.folder);
  form.append('context', signature.context);

  // A plain fetch: this goes to Cloudinary, which must never see our token.
  const response = await fetch(signature.uploadUrl, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Cloudinary rejected the upload (HTTP ${response.status}).`);
  const uploaded = cloudinaryUploadSchema.parse(await response.json());

  const result = await api(`/meetings/${meetingId}/recording`, meetingResponseSchema, {
    method: 'POST',
    body: {
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
      durationSec: recording.durationSec,
    },
  });
  return result.meeting;
}
