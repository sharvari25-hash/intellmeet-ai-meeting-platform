import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { v2 as cloudinary } from 'cloudinary';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { MemoryQueue, setMeetingQueue } from '../../jobs/meetingQueue.js';
import { logger } from '../../lib/logger.js';
import { bearer, createTeam, registerUser, type TestUser } from '../../test/fixtures.js';
import { cleanupDemoData, removeGuests } from '../demo/demo.cleanup.js';
import { DEMO_TEAM_SLUG } from '../demo/demo.constants.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { destroyCloudinaryRecordings } from './recording.cloudinary.js';

const app = createApp();
const destroy = () => vi.mocked(cloudinary.uploader.destroy);

/** The suite's fake cloud (vitest.config.ts). */
const CLOUD = 'test-cloud';
const assetUrl = (name: string) =>
  `https://res.cloudinary.com/${CLOUD}/video/upload/v1/intellmeet/recordings/${name}.webm`;
const assetId = (name: string) => `intellmeet/recordings/${name}`;

const ORIGINAL_CLOUD_NAME = env.CLOUDINARY_CLOUD_NAME;

beforeEach(() => {
  setMeetingQueue(new MemoryQueue());
});

afterEach(() => {
  env.CLOUDINARY_CLOUD_NAME = ORIGINAL_CLOUD_NAME;
});

async function liveMeeting(host?: TestUser): Promise<{ host: TestUser; meetingId: string }> {
  const owner = host ?? (await registerUser(app, { name: 'Ada Lovelace' }));
  const teamId = await createTeam(app, owner);
  const created = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(owner))
    .send({ teamId, title: 'Sprint sync' })
    .expect(201);
  return { host: owner, meetingId: created.body.meeting.id as string };
}

function register(host: TestUser, meetingId: string, name: string) {
  return request(app)
    .post(`/api/meetings/${meetingId}/recording`)
    .set('Authorization', bearer(host))
    .send({ url: assetUrl(name), publicId: assetId(name), durationSec: 30 });
}

/** The AI run finished, so the meeting may be recorded again. */
const finishRun = (meetingId: string) =>
  Meeting.updateOne({ _id: meetingId }, { aiStatus: 'done' });

async function endAndDelete(host: TestUser, meetingId: string) {
  await request(app)
    .post(`/api/meetings/${meetingId}/end`)
    .set('Authorization', bearer(host))
    .expect(200);
  const response = await request(app)
    .delete(`/api/meetings/${meetingId}`)
    .set('Authorization', bearer(host));
  return response.status;
}

describe('a recording does not outlive its meeting', () => {
  it('is deleted from Cloudinary when the host deletes the meeting', async () => {
    const { host, meetingId } = await liveMeeting();
    await register(host, meetingId, 'abc').expect(202);
    await finishRun(meetingId);

    expect(await endAndDelete(host, meetingId)).toBe(204);

    expect(destroy()).toHaveBeenCalledTimes(1);
    expect(destroy()).toHaveBeenCalledWith(
      assetId('abc'),
      expect.objectContaining({
        resource_type: 'video',
        type: 'upload',
        invalidate: true,
        cloud_name: CLOUD,
      }),
    );
    expect(await Meeting.exists({ _id: meetingId })).toBeNull();
  });

  it('still deletes the meeting when Cloudinary fails, and logs the asset', async () => {
    const { host, meetingId } = await liveMeeting();
    await register(host, meetingId, 'abc').expect(202);
    await finishRun(meetingId);
    destroy().mockRejectedValueOnce({ error: { message: 'Server Error', http_code: 500 } });
    const logged = vi.spyOn(logger, 'error');

    expect(await endAndDelete(host, meetingId)).toBe(204);

    expect(await Meeting.exists({ _id: meetingId })).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId,
        publicId: assetId('abc'),
        message: 'Server Error',
        httpCode: 500,
      }),
      expect.stringContaining('remove it by hand'),
    );
    // Nothing logged may carry the API secret.
    expect(JSON.stringify(logged.mock.calls)).not.toContain(env.CLOUDINARY_API_SECRET);
  });

  it('still deletes the meeting when Cloudinary is no longer configured', async () => {
    const { host, meetingId } = await liveMeeting();
    await register(host, meetingId, 'abc').expect(202);
    await finishRun(meetingId);
    env.CLOUDINARY_CLOUD_NAME = undefined;

    expect(await endAndDelete(host, meetingId)).toBe(204);

    expect(destroy()).not.toHaveBeenCalled();
    expect(await Meeting.exists({ _id: meetingId })).toBeNull();
  });

  it('is deleted with a guest account (the idle sweep, or the guest signing out)', async () => {
    const guest = await User.create({
      name: 'Guest',
      email: 'guest-1@demo.intellmeet.app',
      passwordHash: 'x',
      authProvider: 'guest',
    });
    const team = await Team.create({
      name: 'Guest team',
      slug: 'guest-team',
      ownerId: guest._id,
      members: [{ userId: guest._id, role: 'admin', joinedAt: new Date() }],
    });
    await Meeting.create({
      teamId: team._id,
      hostId: guest._id,
      title: 'Guest meeting',
      roomCode: 'GUEST123',
      status: 'ended',
      recording: { url: assetUrl('guest'), publicId: assetId('guest'), storage: 'cloudinary' },
    });

    await removeGuests([guest._id]);

    expect(destroy()).toHaveBeenCalledWith(assetId('guest'), expect.anything());
    expect(await Meeting.countDocuments()).toBe(0);
  });

  it('is deleted when the demo cleanup removes a stale meeting', async () => {
    const demo = await User.create({
      name: 'Demo User',
      email: 'demo@intellmeet.app',
      passwordHash: 'x',
      authProvider: 'demo',
    });
    const team = await Team.create({
      name: 'IntellMeet Demo Team',
      slug: DEMO_TEAM_SLUG,
      ownerId: demo._id,
      members: [{ userId: demo._id, role: 'admin', joinedAt: new Date() }],
    });
    const meeting = await Meeting.create({
      teamId: team._id,
      hostId: demo._id,
      title: 'Old demo meeting',
      roomCode: 'OLD12345',
      status: 'ended',
      recording: { url: assetUrl('stale'), publicId: assetId('stale'), storage: 'cloudinary' },
    });
    await Meeting.collection.updateOne(
      { _id: meeting._id },
      { $set: { createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000) } },
    );

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.meetings).toBe(1);
    expect(destroy()).toHaveBeenCalledWith(assetId('stale'), expect.anything());
  });
});

describe('a recording that no meeting points at any more', () => {
  it('is deleted when a new recording replaces it', async () => {
    const { host, meetingId } = await liveMeeting();
    await register(host, meetingId, 'first').expect(202);
    await finishRun(meetingId);

    await register(host, meetingId, 'second').expect(202);

    expect(destroy()).toHaveBeenCalledTimes(1);
    expect(destroy()).toHaveBeenCalledWith(assetId('first'), expect.anything());
  });

  it('is deleted when it is refused because the last one is still processing', async () => {
    const { host, meetingId } = await liveMeeting();
    await register(host, meetingId, 'first').expect(202);

    await register(host, meetingId, 'second').expect(409);

    expect(destroy()).toHaveBeenCalledTimes(1);
    expect(destroy()).toHaveBeenCalledWith(assetId('second'), expect.anything());
    const meeting = await Meeting.findById(meetingId).lean();
    expect(meeting?.recording?.publicId).toBe(assetId('first'));
  });

  it('is kept when the same registration arrives twice', async () => {
    const { host, meetingId } = await liveMeeting();
    await register(host, meetingId, 'first').expect(202);

    await register(host, meetingId, 'first').expect(409);

    expect(destroy()).not.toHaveBeenCalled();
  });
});

describe('another meeting’s recording', () => {
  it('cannot be registered, so it can never be deleted through somebody else’s meeting', async () => {
    const owner = await liveMeeting();
    await register(owner.host, owner.meetingId, 'theirs').expect(202);
    const other = await liveMeeting(await registerUser(app, { name: 'Mallory' }));

    await register(other.host, other.meetingId, 'theirs').expect(409);

    expect(destroy()).not.toHaveBeenCalled();
    const victim = await Meeting.findById(owner.meetingId).lean();
    expect(victim?.recording?.publicId).toBe(assetId('theirs'));
    const attempt = await Meeting.findById(other.meetingId).lean();
    expect(attempt?.recording?.publicId).toBeUndefined();
  });
});

describe('destroyCloudinaryRecordings', () => {
  it('never deletes anything outside the recordings folder', async () => {
    await destroyCloudinaryRecordings([
      { meetingId: 'm1', publicId: 'intellmeet/avatars/someone' },
      { meetingId: 'm2', publicId: 'intellmeet/recordings/../avatars/x' },
      { meetingId: 'm3', publicId: assetId('ok') },
    ]);

    // The second starts with the folder's name but is not an id Cloudinary
    // would have given an upload there.
    expect(destroy()).toHaveBeenCalledTimes(1);
    expect(destroy()).toHaveBeenCalledWith(assetId('ok'), expect.anything());
  });

  it('works through a large cleanup in batches and counts what it deleted', async () => {
    const recordings = Array.from({ length: 23 }, (_, index) => ({
      meetingId: `m${index}`,
      publicId: assetId(`r${index}`),
    }));
    destroy()
      .mockResolvedValueOnce({ result: 'not found' })
      .mockResolvedValueOnce({ result: 'error' })
      .mockRejectedValueOnce(new Error('socket hang up'));
    const logged = vi.spyOn(logger, 'error');

    await expect(destroyCloudinaryRecordings(recordings)).resolves.toBe(20);

    expect(destroy()).toHaveBeenCalledTimes(23);
    // "not found" is the outcome we wanted; the other two are logged.
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: assetId('r1'), result: 'error' }),
      expect.any(String),
    );
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ publicId: assetId('r2'), message: 'socket hang up' }),
      expect.any(String),
    );
  });
});
