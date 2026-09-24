import { readdir } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { meetingIntelligenceSchema, recordingUploadTargetSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { MemoryQueue, setMeetingQueue } from '../../jobs/meetingQueue.js';
import {
  bearer,
  createInvite,
  createTeam,
  registerUser,
  type TestUser,
} from '../../test/fixtures.js';
import { Meeting } from '../meetings/meeting.model.js';
import { recordingsDir } from './recording.storage.js';

const app = createApp();

/** A few bytes are enough: nothing in these tests decodes the audio. */
const AUDIO = Buffer.from('OggS-not-really-audio-but-bytes');

let queue: MemoryQueue;

const ORIGINAL_CLOUDINARY = {
  cloudName: env.CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
};

/** The suite runs with fake Cloudinary credentials; this is the no-account path. */
function withoutCloudinary(): void {
  env.CLOUDINARY_CLOUD_NAME = undefined;
  env.CLOUDINARY_API_KEY = undefined;
  env.CLOUDINARY_API_SECRET = undefined;
}

beforeEach(() => {
  queue = new MemoryQueue();
  setMeetingQueue(queue);
});

afterEach(() => {
  env.CLOUDINARY_CLOUD_NAME = ORIGINAL_CLOUDINARY.cloudName;
  env.CLOUDINARY_API_KEY = ORIGINAL_CLOUDINARY.apiKey;
  env.CLOUDINARY_API_SECRET = ORIGINAL_CLOUDINARY.apiSecret;
});

async function liveMeeting(): Promise<{
  host: TestUser;
  member: TestUser;
  meetingId: string;
  teamId: string;
}> {
  const host = await registerUser(app, { name: 'Ada Lovelace' });
  const member = await registerUser(app, { name: 'Grace Hopper' });
  const teamId = await createTeam(app, host);
  const code = await createInvite(app, host, teamId);
  await request(app)
    .post('/api/teams/join')
    .set('Authorization', bearer(member))
    .send({ code })
    .expect(200);

  const response = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Sprint sync' })
    .expect(201);

  return { host, member, teamId, meetingId: response.body.meeting.id as string };
}

function upload(user: TestUser, meetingId: string, body = AUDIO, type = 'audio/webm;codecs=opus') {
  return request(app)
    .put(`/api/meetings/${meetingId}/recording/file?durationSec=42`)
    .set('Authorization', bearer(user))
    .set('Content-Type', type)
    .send(body);
}

describe('GET /api/meetings/:id/recording/upload-target', () => {
  it('points at Cloudinary when it is configured', async () => {
    const { host, meetingId } = await liveMeeting();

    const response = await request(app)
      .get(`/api/meetings/${meetingId}/recording/upload-target`)
      .set('Authorization', bearer(host))
      .expect(200);

    const target = recordingUploadTargetSchema.parse(response.body);
    expect(target.kind).toBe('cloudinary');
    expect(target.kind === 'cloudinary' && target.signature.folder).toBe('intellmeet/recordings');
  });

  it('points at the API itself when there is no Cloudinary account', async () => {
    withoutCloudinary();
    const { host, meetingId } = await liveMeeting();

    const response = await request(app)
      .get(`/api/meetings/${meetingId}/recording/upload-target`)
      .set('Authorization', bearer(host))
      .expect(200);

    expect(response.body).toEqual({
      kind: 'server',
      uploadPath: `/meetings/${meetingId}/recording/file`,
      maxBytes: env.MAX_RECORDING_MB * 1024 * 1024,
    });
  });

  it('is for the host only', async () => {
    const { member, meetingId } = await liveMeeting();

    await request(app)
      .get(`/api/meetings/${meetingId}/recording/upload-target`)
      .set('Authorization', bearer(member))
      .expect(403);
  });
});

describe('PUT /api/meetings/:id/recording/file', () => {
  it('stores the audio, marks the meeting queued and enqueues the AI job', async () => {
    withoutCloudinary();
    const { host, meetingId } = await liveMeeting();

    const response = await upload(host, meetingId).expect(202);

    expect(response.body.meeting.aiStatus).toBe('queued');
    expect(response.body.meeting.recording).toMatchObject({
      url: `/api/meetings/${meetingId}/recording/audio`,
      durationSec: 42,
      status: 'ready',
    });
    expect(queue.jobs).toEqual([meetingId]);

    const files = await readdir(recordingsDir());
    expect(files.some((name) => name.startsWith(meetingId) && name.endsWith('.webm'))).toBe(true);
  });

  it('serves the stored audio back to team members, with range support', async () => {
    const { host, member, meetingId } = await liveMeeting();
    await upload(host, meetingId).expect(202);

    const response = await request(app)
      .get(`/api/meetings/${meetingId}/recording/audio`)
      .set('Authorization', bearer(member))
      .set('Range', 'bytes=0-3')
      .expect(206);

    expect(response.headers['content-type']).toContain('audio/webm');
    expect(Buffer.from(response.body as Buffer).toString()).toBe('OggS');
  });

  it('refuses a second upload while the first is still being processed', async () => {
    const { host, meetingId } = await liveMeeting();
    await upload(host, meetingId).expect(202);

    // The status check and the update are atomic, so this cannot slip past.
    const response = await upload(host, meetingId).expect(409);
    expect(response.body.error.message).toMatch(/already being processed/);
    expect(queue.jobs).toHaveLength(1);
  });

  it('only accepts audio', async () => {
    const { host, meetingId } = await liveMeeting();

    await upload(host, meetingId, Buffer.from('{"a":1}'), 'application/json').expect(400);
    await upload(host, meetingId, Buffer.from('<html>'), 'text/html').expect(400);
  });

  it('rejects an empty body', async () => {
    const { host, meetingId } = await liveMeeting();
    await upload(host, meetingId, Buffer.alloc(0)).expect(400);
  });

  it('is for the host only, and invisible to outsiders', async () => {
    const { member, meetingId } = await liveMeeting();
    const outsider = await registerUser(app);

    await upload(member, meetingId).expect(403);
    await upload(outsider, meetingId).expect(404);
  });

  it('refuses a meeting that has not started', async () => {
    const { host, teamId } = await liveMeeting();
    const scheduled = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(host))
      .send({ teamId, title: 'Later', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })
      .expect(201);

    await upload(host, scheduled.body.meeting.id).expect(409);
  });
});

describe('POST /api/meetings/:id/recording (Cloudinary)', () => {
  const body = (url: string, publicId = 'intellmeet/recordings/abc') => ({
    url,
    publicId,
    durationSec: 61.4,
  });

  it('registers our own Cloudinary asset and queues it', async () => {
    const { host, meetingId } = await liveMeeting();

    const response = await request(app)
      .post(`/api/meetings/${meetingId}/recording`)
      .set('Authorization', bearer(host))
      .send(
        body(
          'https://res.cloudinary.com/test-cloud/video/upload/v1/intellmeet/recordings/abc.webm',
        ),
      )
      .expect(202);

    expect(response.body.meeting.recording.durationSec).toBe(61);
    expect(queue.jobs).toEqual([meetingId]);
  });

  it('refuses a URL outside our cloud, which the worker would otherwise fetch', async () => {
    const { host, meetingId } = await liveMeeting();

    for (const url of [
      'https://evil.example/recording.webm',
      'https://res.cloudinary.com/someone-else/video/upload/x.webm',
      'https://res.cloudinary.com.evil.example/test-cloud/x.webm',
    ]) {
      await request(app)
        .post(`/api/meetings/${meetingId}/recording`)
        .set('Authorization', bearer(host))
        .send(body(url))
        .expect(400);
    }

    expect(queue.jobs).toHaveLength(0);
  });

  it('refuses an asset outside the recordings folder', async () => {
    const { host, meetingId } = await liveMeeting();

    await request(app)
      .post(`/api/meetings/${meetingId}/recording`)
      .set('Authorization', bearer(host))
      .send(
        body('https://res.cloudinary.com/test-cloud/video/upload/x.webm', 'intellmeet/avatars/x'),
      )
      .expect(400);
  });
});

describe('POST /api/meetings/:id/ai/retry', () => {
  it('re-queues a failed run', async () => {
    const { host, meetingId } = await liveMeeting();
    await upload(host, meetingId).expect(202);
    await Meeting.updateOne({ _id: meetingId }, { aiStatus: 'failed', aiError: 'boom' });

    const response = await request(app)
      .post(`/api/meetings/${meetingId}/ai/retry`)
      .set('Authorization', bearer(host))
      .expect(202);

    expect(response.body.meeting.aiStatus).toBe('queued');
    expect(queue.jobs).toEqual([meetingId, meetingId]);

    const intelligence = await request(app)
      .get(`/api/meetings/${meetingId}/intelligence`)
      .set('Authorization', bearer(host))
      .expect(200);
    // The old failure reason goes away with the retry.
    expect(intelligence.body.aiError).toBeNull();
  });

  it('only retries a failed run', async () => {
    const { host, meetingId } = await liveMeeting();
    await upload(host, meetingId).expect(202);

    await request(app)
      .post(`/api/meetings/${meetingId}/ai/retry`)
      .set('Authorization', bearer(host))
      .expect(409);
  });

  it('is for the host only', async () => {
    const { host, member, meetingId } = await liveMeeting();
    await upload(host, meetingId).expect(202);
    await Meeting.updateOne({ _id: meetingId }, { aiStatus: 'failed' });

    await request(app)
      .post(`/api/meetings/${meetingId}/ai/retry`)
      .set('Authorization', bearer(member))
      .expect(403);
  });
});

describe('GET /api/meetings/:id/intelligence', () => {
  it('reports the status before any AI output exists', async () => {
    const { member, meetingId } = await liveMeeting();

    const response = await request(app)
      .get(`/api/meetings/${meetingId}/intelligence`)
      .set('Authorization', bearer(member))
      .expect(200);

    expect(meetingIntelligenceSchema.parse(response.body)).toEqual({
      meetingId,
      aiStatus: 'none',
      aiError: null,
      transcript: null,
      insight: null,
    });
  });

  it('is invisible outside the team', async () => {
    const { meetingId } = await liveMeeting();
    const outsider = await registerUser(app);

    await request(app)
      .get(`/api/meetings/${meetingId}/intelligence`)
      .set('Authorization', bearer(outsider))
      .expect(404);
  });
});
