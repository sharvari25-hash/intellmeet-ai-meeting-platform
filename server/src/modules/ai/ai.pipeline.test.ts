import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { MemoryQueue, setMeetingQueue } from '../../jobs/meetingQueue.js';
import { MockProvider } from '../../lib/ai/mock.provider.js';
import { ProviderError, type AIProvider } from '../../lib/ai/types.js';
import {
  bearer,
  createInvite,
  createTeam,
  registerUser,
  type TestUser,
} from '../../test/fixtures.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Notification } from '../notifications/notification.model.js';
import {
  describeFailure,
  isRetryable,
  markProcessingFailed,
  PermanentJobError,
  processMeeting,
} from './ai.pipeline.js';

const app = createApp();

beforeEach(() => {
  setMeetingQueue(new MemoryQueue());
  // The no-account path, which is what a fresh checkout runs.
  env.CLOUDINARY_CLOUD_NAME = undefined;
});

/**
 * A three-person meeting that has been recorded and uploaded - the state the
 * worker picks up.
 */
async function recordedMeeting(): Promise<{
  host: TestUser;
  people: TestUser[];
  meetingId: string;
}> {
  const host = await registerUser(app, { name: 'Demo User' });
  const ada = await registerUser(app, { name: 'Ada Lovelace' });
  const grace = await registerUser(app, { name: 'Grace Hopper' });
  const teamId = await createTeam(app, host);

  for (const member of [ada, grace]) {
    const code = await createInvite(app, host, teamId);
    await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(member))
      .send({ code })
      .expect(200);
  }

  const created = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Sprint sync' })
    .expect(201);
  const meetingId = created.body.meeting.id as string;

  // Attendance is what the socket layer records on room:join.
  await Meeting.updateOne(
    { _id: meetingId },
    {
      participants: [host, ada, grace].map((user) => ({ userId: user.id, joinedAt: new Date() })),
    },
  );

  await request(app)
    .put(`/api/meetings/${meetingId}/recording/file?durationSec=30`)
    .set('Authorization', bearer(host))
    .set('Content-Type', 'audio/webm')
    .send(Buffer.from('fake-audio-bytes'))
    .expect(202);

  return { host, people: [host, ada, grace], meetingId };
}

async function intelligence(user: TestUser, meetingId: string) {
  const response = await request(app)
    .get(`/api/meetings/${meetingId}/intelligence`)
    .set('Authorization', bearer(user))
    .expect(200);
  return response.body;
}

describe('processMeeting', () => {
  it('turns a recording into a transcript, a summary and owned action items', async () => {
    const { host, people, meetingId } = await recordedMeeting();

    await processMeeting(meetingId, { provider: new MockProvider() });

    const result = await intelligence(host, meetingId);
    expect(result.aiStatus).toBe('done');
    expect(result.aiError).toBeNull();

    expect(result.transcript.provider).toBe('mock');
    expect(result.transcript.segments.length).toBeGreaterThan(5);

    expect(result.insight.summary).toContain('Sprint sync');
    expect(result.insight.keyDecisions.length).toBeGreaterThan(0);

    // Every owner the mock named was matched to a real participant id.
    const [, ada, grace] = people as [TestUser, TestUser, TestUser];
    const owners = result.insight.actionItems.map(
      (item: { assigneeId: string }) => item.assigneeId,
    );
    expect(owners).toEqual([ada.id, grace.id]);
    expect(result.insight.actionItems[0]).toMatchObject({ status: 'open', taskId: null });
  });

  it('tells everyone who was in the meeting that the summary is ready', async () => {
    const { people, meetingId } = await recordedMeeting();

    await processMeeting(meetingId, { provider: new MockProvider() });

    const notified = await Notification.find({ type: 'summary_ready' });
    expect(notified.map((row) => row.userId.toString()).sort()).toEqual(
      people.map((person) => person.id).sort(),
    );
    expect(notified[0]?.payload).toMatchObject({ meetingId });
  });

  it('moves through each step in order', async () => {
    const { meetingId } = await recordedMeeting();
    const seen: string[] = [];

    const spy: AIProvider = {
      name: 'spy',
      maxAudioBytes: Infinity,
      transcribe: async (audio) => {
        seen.push((await Meeting.findById(meetingId))?.aiStatus ?? '?');
        return new MockProvider().transcribe(audio);
      },
      analyze: async (input) => {
        seen.push((await Meeting.findById(meetingId))?.aiStatus ?? '?');
        return new MockProvider().analyze(input);
      },
    };

    await processMeeting(meetingId, { provider: spy });

    expect(seen).toEqual(['transcribing', 'summarizing']);
    expect((await Meeting.findById(meetingId))?.aiStatus).toBe('done');
  });

  it('keeps a name it could not match, without inventing an owner', async () => {
    const { host, meetingId } = await recordedMeeting();

    const provider: AIProvider = {
      ...new MockProvider(),
      name: 'stub',
      maxAudioBytes: Infinity,
      transcribe: (audio) => new MockProvider().transcribe(audio),
      analyze: async () => ({
        provider: 'stub',
        summary: 'Short.',
        keyDecisions: [],
        actionItems: [
          { text: 'Call the vendor', assigneeName: 'Sam', dueDate: null },
          { text: 'Fix the bug', assigneeName: 'grace', dueDate: '2026-09-18' },
        ],
      }),
    };

    await processMeeting(meetingId, { provider });

    const { insight } = await intelligence(host, meetingId);
    expect(insight.actionItems[0]).toMatchObject({ assigneeName: 'Sam', assigneeId: null });
    // Matched, and stored under the participant's real name.
    expect(insight.actionItems[1]).toMatchObject({ assigneeName: 'Grace Hopper' });
    expect(insight.actionItems[1].assigneeId).not.toBeNull();
  });

  it('overwrites rather than duplicates when a run is repeated', async () => {
    const { host, meetingId } = await recordedMeeting();

    await processMeeting(meetingId, { provider: new MockProvider() });
    await processMeeting(meetingId, { provider: new MockProvider() });

    const { insight } = await intelligence(host, meetingId);
    expect(insight.actionItems).toHaveLength(2);
  });

  it('fails permanently for a meeting with no recording', async () => {
    const host = await registerUser(app);
    const teamId = await createTeam(app, host);
    const created = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(host))
      .send({ teamId, title: 'Unrecorded' })
      .expect(201);

    const error = await processMeeting(created.body.meeting.id, {
      provider: new MockProvider(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PermanentJobError);
    expect(isRetryable(error)).toBe(false);
  });

  it('fails permanently when the local file has gone', async () => {
    const { meetingId } = await recordedMeeting();
    await Meeting.updateOne(
      { _id: meetingId },
      { 'recording.publicId': `${meetingId}-1700000000000.webm` },
    );

    const error = await processMeeting(meetingId, { provider: new MockProvider() }).catch(
      (caught: unknown) => caught,
    );

    expect(isRetryable(error)).toBe(false);
    expect(describeFailure(error)).toMatch(/no longer on the server/);
  });
});

describe('failure handling', () => {
  it('records the final failure with a message fit for the UI', async () => {
    const { host, meetingId } = await recordedMeeting();

    await markProcessingFailed(
      meetingId,
      describeFailure(new ProviderError('groq', 'x', 429, true)),
    );

    const result = await intelligence(host, meetingId);
    expect(result.aiStatus).toBe('failed');
    expect(result.aiError).toBe('The AI service is rate-limiting requests. Retry in a minute.');
  });

  it('classifies what is worth retrying', () => {
    expect(isRetryable(new ProviderError('groq', 'x', 503, true))).toBe(true);
    expect(isRetryable(new ProviderError('groq', 'x', 401, false))).toBe(false);
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true);
  });

  it('never puts provider detail or credentials into the UI message', () => {
    const leaky = new ProviderError(
      'groq',
      'groq returned HTTP 401: key gsk_secret is invalid',
      401,
      false,
    );
    expect(describeFailure(leaky)).not.toContain('gsk_secret');
    expect(describeFailure(new Error('stack trace with /home/app/secret'))).toBe(
      'Processing failed unexpectedly. Try again.',
    );
  });

  it('leaves the meeting mid-pipeline when a step throws, for the queue to settle', async () => {
    const { meetingId } = await recordedMeeting();
    const provider: AIProvider = {
      name: 'down',
      maxAudioBytes: Infinity,
      transcribe: vi.fn().mockRejectedValue(new ProviderError('down', 'x', 503, true)),
      analyze: vi.fn(),
    };

    await expect(processMeeting(meetingId, { provider })).rejects.toBeInstanceOf(ProviderError);
    expect((await Meeting.findById(meetingId))?.aiStatus).toBe('transcribing');
  });
});

describe('deleting a meeting', () => {
  it('removes its transcript and insight too', async () => {
    const { host, meetingId } = await recordedMeeting();
    await processMeeting(meetingId, { provider: new MockProvider() });
    await request(app)
      .post(`/api/meetings/${meetingId}/end`)
      .set('Authorization', bearer(host))
      .expect(200);

    await request(app)
      .delete(`/api/meetings/${meetingId}`)
      .set('Authorization', bearer(host))
      .expect(204);

    const { Transcript } = await import('./transcript.model.js');
    const { MeetingInsight } = await import('./insight.model.js');
    expect(await Transcript.countDocuments({ meetingId })).toBe(0);
    expect(await MeetingInsight.countDocuments({ meetingId })).toBe(0);
  });

  it('removes notifications that would link to it, and its chat', async () => {
    const { host, meetingId } = await recordedMeeting();
    await processMeeting(meetingId, { provider: new MockProvider() });
    const { Message } = await import('../chat/message.model.js');
    await Message.create({ meetingId, senderId: host.id, senderName: 'Demo User', text: 'hi' });
    expect(await Notification.countDocuments({ 'payload.meetingId': meetingId })).toBeGreaterThan(
      0,
    );

    await request(app)
      .post(`/api/meetings/${meetingId}/end`)
      .set('Authorization', bearer(host))
      .expect(200);
    await request(app)
      .delete(`/api/meetings/${meetingId}`)
      .set('Authorization', bearer(host))
      .expect(204);

    // A "summary ready" that opens "Meeting not found" is worse than none.
    expect(await Notification.countDocuments({ 'payload.meetingId': meetingId })).toBe(0);
    expect(await Message.countDocuments({ meetingId })).toBe(0);
  });
});
