import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { messageHistorySchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import {
  bearer,
  createInvite,
  createTeam,
  registerUser,
  type TestUser,
} from '../../test/fixtures.js';
import { createMessage } from './chat.service.js';

const app = createApp();

async function meetingWithMembers(): Promise<{
  host: TestUser;
  member: TestUser;
  meetingId: string;
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

  const response = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Standup' })
    .expect(201);

  return { host, member, meetingId: response.body.meeting.id as string };
}

describe('GET /api/meetings/:id/messages', () => {
  it('returns history oldest-first with sender details attached', async () => {
    const { host, member, meetingId } = await meetingWithMembers();

    await createMessage(meetingId, host.id, 'First');
    await createMessage(meetingId, member.id, 'Second');

    const response = await request(app)
      .get(`/api/meetings/${meetingId}/messages`)
      .set('Authorization', bearer(member))
      .expect(200);

    expect(messageHistorySchema.safeParse(response.body).success).toBe(true);
    expect(response.body.messages.map((m: { text: string }) => m.text)).toEqual([
      'First',
      'Second',
    ]);
    // Denormalised, so a socket broadcast renders without a second lookup.
    expect(response.body.messages[0].senderName).toBe(host.name);
    expect(response.body.nextCursor).toBeNull();
  });

  it('pages backwards with a cursor rather than an offset', async () => {
    const { host, meetingId } = await meetingWithMembers();

    for (let i = 1; i <= 5; i += 1) {
      await createMessage(meetingId, host.id, `Message ${i}`);
    }

    const firstPage = await request(app)
      .get(`/api/meetings/${meetingId}/messages?limit=2`)
      .set('Authorization', bearer(host))
      .expect(200);

    // Newest two, in chronological order within the page.
    expect(firstPage.body.messages.map((m: { text: string }) => m.text)).toEqual([
      'Message 4',
      'Message 5',
    ]);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await request(app)
      .get(
        `/api/meetings/${meetingId}/messages?limit=2&before=${encodeURIComponent(
          firstPage.body.nextCursor as string,
        )}`,
      )
      .set('Authorization', bearer(host))
      .expect(200);

    expect(secondPage.body.messages.map((m: { text: string }) => m.text)).toEqual([
      'Message 2',
      'Message 3',
    ]);
  });

  it('reports the end of history with a null cursor', async () => {
    const { host, meetingId } = await meetingWithMembers();
    await createMessage(meetingId, host.id, 'Only one');

    const response = await request(app)
      .get(`/api/meetings/${meetingId}/messages?limit=10`)
      .set('Authorization', bearer(host))
      .expect(200);

    expect(response.body.messages).toHaveLength(1);
    expect(response.body.nextCursor).toBeNull();
  });

  it('refuses history to someone outside the team', async () => {
    const { host, meetingId } = await meetingWithMembers();
    await createMessage(meetingId, host.id, 'Private');

    const stranger = await registerUser(app);

    await request(app)
      .get(`/api/meetings/${meetingId}/messages`)
      .set('Authorization', bearer(stranger))
      .expect(404);
  });

  it('requires authentication', async () => {
    const { meetingId } = await meetingWithMembers();
    await request(app).get(`/api/meetings/${meetingId}/messages`).expect(401);
  });
});
