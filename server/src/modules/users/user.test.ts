import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { publicUserSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { bearer, registerUser } from '../../test/fixtures.js';
import { User } from './user.model.js';

const app = createApp();

describe('GET /api/users/me', () => {
  it('returns the caller in the public shape', async () => {
    const user = await registerUser(app, { name: 'Grace Hopper' });

    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(publicUserSchema.safeParse(response.body.user).success).toBe(true);
    expect(response.body.user.name).toBe('Grace Hopper');
    expect(response.body.user.avatarUrl).toBeNull();
  });

  it('requires authentication', async () => {
    await request(app).get('/api/users/me').expect(401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates the display name', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(user))
      .send({ name: 'Rear Admiral Hopper' })
      .expect(200);

    expect(response.body.user.name).toBe('Rear Admiral Hopper');
  });

  it('sets and then clears the avatar', async () => {
    const user = await registerUser(app);
    const url = 'https://res.cloudinary.com/demo/image/upload/v1/avatar.png';

    const set = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(user))
      .send({ avatarUrl: url })
      .expect(200);
    expect(set.body.user.avatarUrl).toBe(url);

    // `null` is a meaningful value here, not "field omitted".
    const cleared = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(user))
      .send({ avatarUrl: null })
      .expect(200);
    expect(cleared.body.user.avatarUrl).toBeNull();
  });

  it('rejects an empty body', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(user))
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an avatar value that is not a URL', async () => {
    const user = await registerUser(app);

    await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(user))
      .send({ avatarUrl: 'javascript:alert(1)' })
      .expect(400);
  });

  it('ignores fields the caller is not allowed to set', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', bearer(user))
      .send({ name: 'Ada', role: 'admin', email: 'somebody@else.com' })
      .expect(200);

    // zod objects strip unknown keys, so a privilege-escalation attempt by
    // mass assignment never reaches the service layer.
    expect(response.body.user.role).toBe('member');
    expect(response.body.user.email).toBe(user.email);

    const stored = await User.findById(user.id);
    expect(stored?.role).toBe('member');
  });
});
