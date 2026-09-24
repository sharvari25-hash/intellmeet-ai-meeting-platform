import { describe, expect, it, vi } from 'vitest';
import { authPayload } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { uploadRecording } from './ai.api';

const MEETING_ID = '507f1f77bcf86cd799439011';

const MEETING = {
  id: MEETING_ID,
  teamId: '507f1f77bcf86cd799439012',
  title: 'Sync',
  description: null,
  hostId: '507f1f77bcf86cd799439013',
  hostName: 'Ada',
  status: 'ended',
  roomCode: 'ABC2345',
  scheduledAt: null,
  startedAt: null,
  endedAt: null,
  durationSec: null,
  participants: [],
  recording: null,
  aiStatus: 'queued',
  isHost: true,
  createdAt: new Date().toISOString(),
};

function signIn() {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: 'token',
  });
}

const recording = { blob: new Blob(['audio'], { type: 'audio/webm' }), durationSec: 42 };

describe('uploadRecording', () => {
  it('sends the file to the API when the server says there is no Cloudinary', async () => {
    signIn();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/upload-target')) {
        return Response.json({ kind: 'server', uploadPath: '/x', maxBytes: 1000 });
      }
      return Response.json({ meeting: MEETING }, { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const meeting = await uploadRecording(MEETING_ID, recording);

    expect(meeting.aiStatus).toBe('queued');
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/meetings/${MEETING_ID}/recording/file?durationSec=42`);
    expect(init.method).toBe('PUT');
    // The blob itself, typed by its own MIME type - not JSON.
    expect(init.body).toBe(recording.blob);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('audio/webm');
  });

  it('refuses early when the file is bigger than the server accepts', async () => {
    signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ kind: 'server', uploadPath: '/x', maxBytes: 2 })),
    );

    await expect(uploadRecording(MEETING_ID, recording)).rejects.toThrow(/larger than the server/);
  });

  it('uploads straight to Cloudinary, then tells the API where it landed', async () => {
    signIn();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/upload-target')) {
        return Response.json({
          kind: 'cloudinary',
          signature: {
            cloudName: 'demo',
            apiKey: '123',
            timestamp: 1700000000,
            signature: 'sig',
            folder: 'intellmeet/recordings',
            context: 'uploadedBy=u',
            uploadUrl: 'https://api.cloudinary.com/v1_1/demo/video/upload',
          },
        });
      }
      if (url.startsWith('https://api.cloudinary.com')) {
        return Response.json({
          secure_url:
            'https://res.cloudinary.com/demo/video/upload/v1/intellmeet/recordings/r.webm',
          public_id: 'intellmeet/recordings/r',
        });
      }
      return Response.json({ meeting: MEETING }, { status: 202 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await uploadRecording(MEETING_ID, recording);

    const [cloudUrl, cloudInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(cloudUrl).toBe('https://api.cloudinary.com/v1_1/demo/video/upload');
    const form = cloudInit.body as FormData;
    expect(form.get('signature')).toBe('sig');
    expect(form.get('folder')).toBe('intellmeet/recordings');
    // Our bearer token must never be sent to a third party.
    expect(cloudInit.headers).toBeUndefined();

    const [registerUrl, registerInit] = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect(registerUrl).toBe(`/api/meetings/${MEETING_ID}/recording`);
    expect(JSON.parse(registerInit.body as string)).toEqual({
      url: 'https://res.cloudinary.com/demo/video/upload/v1/intellmeet/recordings/r.webm',
      publicId: 'intellmeet/recordings/r',
      durationSec: 42,
    });
  });
});
