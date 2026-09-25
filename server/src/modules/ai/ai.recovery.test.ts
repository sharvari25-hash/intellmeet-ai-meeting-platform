import { beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import request from 'supertest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { runQuickSweep } from '../../jobs/housekeeping.js';
import { MemoryQueue, setMeetingQueue, type MeetingQueue } from '../../jobs/meetingQueue.js';
import { bearer, createTeam, registerUser, type TestUser } from '../../test/fixtures.js';
import { Meeting } from '../meetings/meeting.model.js';
import { failLostAiRuns, LOST_RUN_AFTER_MS, LOST_RUN_MESSAGE } from './ai.recovery.js';

const app = createApp();
let queue: MemoryQueue;

beforeEach(() => {
  queue = new MemoryQueue();
  setMeetingQueue(queue);
  // Recordings go to local disk: the no-account path.
  env.CLOUDINARY_CLOUD_NAME = undefined;
});

/** A meeting whose recording has been uploaded, so its run is queued. */
async function queuedRun(): Promise<{ host: TestUser; meetingId: string }> {
  const host = await registerUser(app, { name: 'Demo User' });
  const teamId = await createTeam(app, host);

  const created = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Release sync' })
    .expect(201);
  const meetingId = created.body.meeting.id as string;

  await request(app)
    .put(`/api/meetings/${meetingId}/recording/file?durationSec=30`)
    .set('Authorization', bearer(host))
    .set('Content-Type', 'audio/webm')
    .send(Buffer.from('fake-audio-bytes'))
    .expect(202);

  return { host, meetingId };
}

/** Just past the point where a run with no job counts as lost. */
const later = () => new Date(Date.now() + LOST_RUN_AFTER_MS + 60_000);

/** What Redis restarting does to the queue: every job is gone. */
function loseEveryJob(): void {
  queue.jobs.length = 0;
}

async function aiState(meetingId: string) {
  const meeting = await Meeting.findById(meetingId).lean();
  return { status: meeting?.aiStatus, error: meeting?.aiError };
}

describe('failLostAiRuns', () => {
  it('fails a run whose job the queue no longer holds, and Retry queues it again', async () => {
    const { host, meetingId } = await queuedRun();
    await Meeting.updateOne({ _id: meetingId }, { aiStatus: 'transcribing' });
    loseEveryJob();

    await expect(failLostAiRuns({ now: later() })).resolves.toBe(1);
    expect(await aiState(meetingId)).toEqual({ status: 'failed', error: LOST_RUN_MESSAGE });

    const retried = await request(app)
      .post(`/api/meetings/${meetingId}/ai/retry`)
      .set('Authorization', bearer(host))
      .expect(202);
    expect(retried.body.meeting.aiStatus).toBe('queued');
    expect(queue.jobs).toEqual([meetingId]);
  });

  it('fails runs lost at any step', async () => {
    const runs = await Promise.all([queuedRun(), queuedRun(), queuedRun()]);
    const steps = ['queued', 'transcribing', 'summarizing'] as const;
    await Promise.all(
      runs.map(({ meetingId }, index) =>
        Meeting.updateOne({ _id: meetingId }, { aiStatus: steps[index] }),
      ),
    );
    loseEveryJob();

    await expect(failLostAiRuns({ now: later() })).resolves.toBe(3);
    for (const { meetingId } of runs) {
      expect((await aiState(meetingId)).status).toBe('failed');
    }
  });

  it('leaves a run alone while the queue still holds its job', async () => {
    const { meetingId } = await queuedRun();

    await expect(failLostAiRuns({ now: later() })).resolves.toBe(0);
    expect(await aiState(meetingId)).toEqual({ status: 'queued', error: null });
  });

  it('gives a run ten minutes before looking for its job', async () => {
    const { meetingId } = await queuedRun();
    loseEveryJob();

    const soon = new Date(Date.now() + LOST_RUN_AFTER_MS - 60_000);
    await expect(failLostAiRuns({ now: soon })).resolves.toBe(0);
    expect((await aiState(meetingId)).status).toBe('queued');
  });

  it('does not ask the queue when no run is in progress', async () => {
    const { meetingId } = await queuedRun();
    await Meeting.updateOne({ _id: meetingId }, { aiStatus: 'done' });
    const unreadable: MeetingQueue = {
      enqueue: async () => {},
      pendingMeetingIds: () => Promise.reject(new Error('the queue must not be read')),
      close: async () => {},
    };

    await expect(failLostAiRuns({ now: later(), queue: unreadable })).resolves.toBe(0);
    expect((await aiState(meetingId)).status).toBe('done');
  });

  it('fails nothing when the queue cannot be read', async () => {
    const { meetingId } = await queuedRun();
    const unreachable: MeetingQueue = {
      enqueue: async () => {},
      pendingMeetingIds: () => Promise.reject(new Error('connect ECONNREFUSED')),
      close: async () => {},
    };

    await expect(failLostAiRuns({ now: later(), queue: unreachable })).rejects.toThrow(
      'ECONNREFUSED',
    );
    expect((await aiState(meetingId)).status).toBe('queued');
  });

  it('does not overwrite a run that finished while the queue was being read', async () => {
    const { meetingId } = await queuedRun();
    // The job completes between the database read and the queue read: the
    // run is done and the job is gone.
    const racing: MeetingQueue = {
      enqueue: async () => {},
      pendingMeetingIds: async () => {
        await Meeting.updateOne({ _id: meetingId }, { aiStatus: 'done' });
        return new Set();
      },
      close: async () => {},
    };

    await expect(failLostAiRuns({ now: later(), queue: racing })).resolves.toBe(0);
    expect(await aiState(meetingId)).toEqual({ status: 'done', error: null });
  });

  it('runs as part of the periodic housekeeping sweep', async () => {
    const { meetingId } = await queuedRun();
    loseEveryJob();
    // The sweep uses the real clock, so age the run instead.
    await Meeting.collection.updateOne(
      { _id: new Types.ObjectId(meetingId) },
      { $set: { updatedAt: new Date(Date.now() - LOST_RUN_AFTER_MS - 60_000) } },
    );

    await runQuickSweep();
    expect(await aiState(meetingId)).toEqual({ status: 'failed', error: LOST_RUN_MESSAGE });
  });
});
