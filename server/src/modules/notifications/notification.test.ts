import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { notificationListSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { bearer, registerUser, type TestUser } from '../../test/fixtures.js';
import { createNotifications } from './notification.service.js';

const app = createApp();

async function seedFor(user: TestUser, count = 3): Promise<void> {
  await createNotifications(
    Array.from({ length: count }, (_, index) => ({
      userId: user.id,
      type: 'meeting_started' as const,
      title: `Meeting ${index + 1} started`,
      body: 'Join now',
      payload: { meetingId: `m-${index}` },
    })),
  );
}

describe('GET /api/notifications', () => {
  it('returns the caller’s notifications, newest first, with an unread count', async () => {
    const user = await registerUser(app);
    await seedFor(user, 3);

    const response = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(notificationListSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.notifications).toHaveLength(3);
    expect(response.body.unreadCount).toBe(3);
    expect(response.body.notifications[0].title).toBe('Meeting 3 started');
  });

  it('never leaks another user’s notifications', async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);
    await seedFor(other, 2);

    const response = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(response.body.notifications).toHaveLength(0);
    expect(response.body.unreadCount).toBe(0);
  });

  it('filters to unread only on request', async () => {
    const user = await registerUser(app);
    await seedFor(user, 2);

    const all = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(user))
      .expect(200);

    await request(app)
      .patch(`/api/notifications/${all.body.notifications[0].id}/read`)
      .set('Authorization', bearer(user))
      .expect(200);

    const unread = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(unread.body.notifications).toHaveLength(1);
    expect(unread.body.unreadCount).toBe(1);
  });

  it('requires authentication', async () => {
    await request(app).get('/api/notifications').expect(401);
  });
});

describe('marking notifications read', () => {
  it('marks one as read and is idempotent', async () => {
    const user = await registerUser(app);
    await seedFor(user, 1);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(user))
      .expect(200);
    const id = list.body.notifications[0].id as string;

    const first = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', bearer(user))
      .expect(200);
    expect(first.body.notification.readAt).not.toBeNull();

    // Re-reading must not move the timestamp: "when did I first see this" is
    // the useful fact.
    const second = await request(app)
      .patch(`/api/notifications/${id}/read`)
      .set('Authorization', bearer(user))
      .expect(200);
    expect(second.body.notification.readAt).toBe(first.body.notification.readAt);
  });

  it('refuses to mark someone else’s notification as read', async () => {
    const user = await registerUser(app);
    const other = await registerUser(app);
    await seedFor(other, 1);

    const list = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(other))
      .expect(200);

    // The query is scoped by userId, so guessing an id achieves nothing.
    await request(app)
      .patch(`/api/notifications/${list.body.notifications[0].id}/read`)
      .set('Authorization', bearer(user))
      .expect(404);
  });

  it('marks everything read in one call', async () => {
    const user = await registerUser(app);
    await seedFor(user, 4);

    const response = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', bearer(user))
      .expect(200);
    expect(response.body.updated).toBe(4);

    const after = await request(app)
      .get('/api/notifications')
      .set('Authorization', bearer(user))
      .expect(200);
    expect(after.body.unreadCount).toBe(0);
  });

  it('rejects a malformed id with a validation error, not a cast crash', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .patch('/api/notifications/not-an-id/read')
      .set('Authorization', bearer(user))
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
