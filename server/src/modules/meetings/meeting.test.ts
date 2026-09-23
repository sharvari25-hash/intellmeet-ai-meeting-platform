import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { meetingSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import {
  bearer,
  createInvite,
  createTeam,
  registerUser,
  type TestUser,
} from '../../test/fixtures.js';
import { Meeting } from './meeting.model.js';

const app = createApp();

/** An owner with a team, plus a second member who joined it. */
async function teamWithTwoMembers(): Promise<{
  host: TestUser;
  member: TestUser;
  teamId: string;
}> {
  const host = await registerUser(app);
  const member = await registerUser(app);
  const teamId = await createTeam(app, host);
  const code = await createInvite(app, host, teamId);

  await request(app)
    .post('/api/teams/join')
    .set('Authorization', bearer(member))
    .send({ code })
    .expect(200);

  return { host, member, teamId };
}

async function createMeeting(
  user: TestUser,
  teamId: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, never> & { id: string; roomCode: string }> {
  const response = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(user))
    .send({ teamId, title: 'Weekly sync', ...body })
    .expect(201);

  return response.body.meeting;
}

describe('POST /api/meetings', () => {
  it('starts immediately when no scheduledAt is given', async () => {
    const { host, teamId } = await teamWithTwoMembers();

    const response = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(host))
      .send({ teamId, title: 'Weekly sync' })
      .expect(201);

    expect(meetingSchema.safeParse(response.body.meeting).success).toBe(true);
    expect(response.body.meeting.status).toBe('live');
    expect(response.body.meeting.startedAt).not.toBeNull();
    expect(response.body.meeting.scheduledAt).toBeNull();
    expect(response.body.meeting.isHost).toBe(true);
  });

  it('schedules for later when scheduledAt is given', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const when = new Date(Date.now() + 3_600_000).toISOString();

    const response = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(host))
      .send({ teamId, title: 'Planning', scheduledAt: when })
      .expect(201);

    expect(response.body.meeting.status).toBe('scheduled');
    expect(response.body.meeting.startedAt).toBeNull();
    expect(response.body.meeting.scheduledAt).toBe(when);
  });

  it('issues a unique, unambiguous room code', async () => {
    const { host, teamId } = await teamWithTwoMembers();

    const first = await createMeeting(host, teamId);
    const second = await createMeeting(host, teamId, { title: 'Another' });

    // No I/L/O/U/0/1: those are the characters people mistype when reading a
    // code off a screen.
    expect(first.roomCode).toMatch(/^[A-HJ-NP-TV-Z2-9]{7}$/);
    expect(first.roomCode).not.toBe(second.roomCode);
  });

  it('refuses to create a meeting in a team the caller is not in', async () => {
    const { teamId } = await teamWithTwoMembers();
    const stranger = await registerUser(app);

    const response = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(stranger))
      .send({ teamId, title: 'Sneaky' })
      .expect(404);

    // 404 rather than 403, so the existence of another tenant's team is not
    // confirmed.
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('requires authentication', async () => {
    await request(app).post('/api/meetings').send({ title: 'Nope' }).expect(401);
  });

  it('rejects a malformed scheduledAt', async () => {
    const { host, teamId } = await teamWithTwoMembers();

    const response = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(host))
      .send({ teamId, title: 'Bad date', scheduledAt: 'next tuesday' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/meetings', () => {
  it('lists only meetings from the caller’s teams', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    await createMeeting(host, teamId, { title: 'Mine' });

    const outsider = await registerUser(app);
    const otherTeam = await createTeam(app, outsider, 'Other Team');
    await createMeeting(outsider, otherTeam, { title: 'Theirs' });

    const response = await request(app)
      .get('/api/meetings')
      .set('Authorization', bearer(host))
      .expect(200);

    expect(response.body.meetings).toHaveLength(1);
    expect(response.body.meetings[0].title).toBe('Mine');
    expect(response.body.total).toBe(1);
  });

  it('filters by status and paginates', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    await createMeeting(host, teamId, { title: 'Live one' });
    await createMeeting(host, teamId, {
      title: 'Future one',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const live = await request(app)
      .get('/api/meetings?status=live')
      .set('Authorization', bearer(host))
      .expect(200);
    expect(live.body.meetings).toHaveLength(1);
    expect(live.body.meetings[0].title).toBe('Live one');

    const paged = await request(app)
      .get('/api/meetings?limit=1&page=2')
      .set('Authorization', bearer(host))
      .expect(200);
    expect(paged.body.meetings).toHaveLength(1);
    expect(paged.body.total).toBe(2);
  });
});

describe('GET /api/meetings/code/:roomCode', () => {
  it('resolves a code for a team member', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    const response = await request(app)
      .get(`/api/meetings/code/${meeting.roomCode}`)
      .set('Authorization', bearer(member))
      .expect(200);

    expect(response.body.meeting.id).toBe(meeting.id);
    // The joiner is not the host, and the UI keys its controls off this.
    expect(response.body.meeting.isHost).toBe(false);
  });

  it('accepts a lower-case code, since people retype them by hand', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    await request(app)
      .get(`/api/meetings/code/${meeting.roomCode.toLowerCase()}`)
      .set('Authorization', bearer(host))
      .expect(200);
  });

  it('refuses a code for a team the caller is not in', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);
    const stranger = await registerUser(app);

    await request(app)
      .get(`/api/meetings/code/${meeting.roomCode}`)
      .set('Authorization', bearer(stranger))
      .expect(404);
  });

  it('reports a clear conflict for an ended meeting rather than a bare 404', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    await request(app)
      .post(`/api/meetings/${meeting.id}/end`)
      .set('Authorization', bearer(host))
      .expect(200);

    const response = await request(app)
      .get(`/api/meetings/code/${meeting.roomCode}`)
      .set('Authorization', bearer(host))
      .expect(409);

    expect(response.body.error.message).toContain('ended');
  });

  it('404s an unknown code', async () => {
    const { host } = await teamWithTwoMembers();

    await request(app)
      .get('/api/meetings/code/ZZZZZZZ')
      .set('Authorization', bearer(host))
      .expect(404);
  });
});

describe('meeting lifecycle', () => {
  it('starts a scheduled meeting, and starting twice is a no-op', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId, {
      title: 'Planning',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const started = await request(app)
      .post(`/api/meetings/${meeting.id}/start`)
      .set('Authorization', bearer(host))
      .expect(200);
    expect(started.body.meeting.status).toBe('live');

    // Idempotent: a double-click must not produce a scary error.
    const again = await request(app)
      .post(`/api/meetings/${meeting.id}/start`)
      .set('Authorization', bearer(host))
      .expect(200);
    expect(again.body.meeting.startedAt).toBe(started.body.meeting.startedAt);
  });

  it('ends a meeting and computes its duration', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    const response = await request(app)
      .post(`/api/meetings/${meeting.id}/end`)
      .set('Authorization', bearer(host))
      .expect(200);

    expect(response.body.meeting.status).toBe('ended');
    expect(response.body.meeting.endedAt).not.toBeNull();
    expect(response.body.meeting.durationSec).toBeGreaterThanOrEqual(0);
  });

  it('lets only the host start, end, edit or delete', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    // A team member can see the meeting...
    await request(app)
      .get(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(member))
      .expect(200);

    // ...but cannot control it. 403, not 404: the meeting's existence is not
    // a secret from a fellow team member.
    await request(app)
      .post(`/api/meetings/${meeting.id}/end`)
      .set('Authorization', bearer(member))
      .expect(403);

    await request(app)
      .patch(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(member))
      .send({ title: 'Hijacked' })
      .expect(403);

    await request(app)
      .delete(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(member))
      .expect(403);
  });

  it('refuses to delete a live meeting', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    const response = await request(app)
      .delete(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(host))
      .expect(409);
    expect(response.body.error.message).toContain('End the meeting');

    await request(app)
      .post(`/api/meetings/${meeting.id}/end`)
      .set('Authorization', bearer(host))
      .expect(200);

    await request(app)
      .delete(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(host))
      .expect(204);

    expect(await Meeting.findById(meeting.id)).toBeNull();
  });

  it('refuses to edit an ended meeting', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    await request(app)
      .post(`/api/meetings/${meeting.id}/end`)
      .set('Authorization', bearer(host))
      .expect(200);

    await request(app)
      .patch(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(host))
      .send({ title: 'Too late' })
      .expect(409);
  });
});

describe('meeting cache', () => {
  it('serves a repeat read from cache but still re-checks membership', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    // Warm the cache.
    await request(app)
      .get(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(member))
      .expect(200);

    // Rename behind the cache's back, without going through the service that
    // would invalidate it. The stale title proves the read was cached.
    await Meeting.updateOne({ _id: meeting.id }, { $set: { title: 'Renamed directly' } });

    const cachedRead = await request(app)
      .get(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(member))
      .expect(200);
    expect(cachedRead.body.meeting.title).toBe('Weekly sync');

    // Authorisation is never cached: removing the member must take effect at
    // once, even while the meeting view is still warm.
    await request(app)
      .delete(`/api/teams/${teamId}/members/${member.id}`)
      .set('Authorization', bearer(host))
      .expect(200);

    await request(app)
      .get(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(member))
      .expect(404);
  });

  it('invalidates the cache when the meeting is updated', async () => {
    const { host, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId);

    await request(app)
      .get(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(host))
      .expect(200);

    await request(app)
      .patch(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(host))
      .send({ title: 'Renamed properly' })
      .expect(200);

    const after = await request(app)
      .get(`/api/meetings/${meeting.id}`)
      .set('Authorization', bearer(host))
      .expect(200);

    expect(after.body.meeting.title).toBe('Renamed properly');
  });
});

describe('meeting_started notifications', () => {
  /** Titles of every `meeting_started` notification sitting in a user's bell. */
  async function startedNotifications(user: TestUser): Promise<string[]> {
    const response = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(user))
      .expect(200);

    return (response.body.notifications as { type: string; body: string }[])
      .filter((notification) => notification.type === 'meeting_started')
      .map((notification) => notification.body);
  }

  it('tells the rest of the team when a meeting is created already live', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();

    await createMeeting(host, teamId, { title: 'Incident bridge' });

    expect(await startedNotifications(member)).toEqual(['"Incident bridge" has started']);
  });

  it('does not notify the host about their own meeting', async () => {
    const { host, teamId } = await teamWithTwoMembers();

    await createMeeting(host, teamId, { title: 'Incident bridge' });

    expect(await startedNotifications(host)).toEqual([]);
  });

  it('stays quiet when the meeting is only scheduled', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();

    await createMeeting(host, teamId, {
      title: 'Next week',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect(await startedNotifications(member)).toEqual([]);
  });

  it('notifies when the host starts a scheduled meeting', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId, {
      title: 'Sprint review',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    await request(app)
      .post(`/api/meetings/${meeting.id}/start`)
      .set('Authorization', bearer(host))
      .expect(200);

    expect(await startedNotifications(member)).toEqual(['"Sprint review" has started']);
  });

  it('does not notify twice when start is called again', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId, {
      title: 'Sprint review',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    // A double-clicked Start button, or a client that retried the request.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post(`/api/meetings/${meeting.id}/start`)
        .set('Authorization', bearer(host))
        .expect(200);
    }

    expect(await startedNotifications(member)).toHaveLength(1);
  });

  it('carries enough payload for the bell to link into the room', async () => {
    const { host, member, teamId } = await teamWithTwoMembers();
    const meeting = await createMeeting(host, teamId, { title: 'Incident bridge' });

    const response = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(member))
      .expect(200);

    expect(response.body.notifications[0].payload).toMatchObject({
      meetingId: meeting.id,
      teamId,
      roomCode: meeting.roomCode,
    });
  });
});
