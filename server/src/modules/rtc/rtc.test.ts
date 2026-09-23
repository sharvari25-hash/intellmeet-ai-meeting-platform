import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { iceServersResponseSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { bearer, registerUser } from '../../test/fixtures.js';

const app = createApp();

const ORIGINAL = {
  urls: env.TURN_URLS,
  username: env.TURN_USERNAME,
  credential: env.TURN_CREDENTIAL,
};

afterEach(() => {
  env.TURN_URLS = ORIGINAL.urls;
  env.TURN_USERNAME = ORIGINAL.username;
  env.TURN_CREDENTIAL = ORIGINAL.credential;
});

describe('GET /api/rtc/ice-servers', () => {
  it('returns STUN servers in the shape RTCPeerConnection expects', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/rtc/ice-servers')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(iceServersResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.iceServers[0].urls).toEqual(
      expect.arrayContaining([expect.stringContaining('stun:')]),
    );
  });

  it('reports hasTurn=false when no TURN relay is configured', async () => {
    const user = await registerUser(app);

    env.TURN_URLS = undefined;
    env.TURN_USERNAME = undefined;
    env.TURN_CREDENTIAL = undefined;

    const response = await request(app)
      .get('/api/rtc/ice-servers')
      .set('Authorization', bearer(user))
      .expect(200);

    // The lobby uses this to warn that restrictive networks may fail, instead
    // of the call silently never connecting.
    expect(response.body.hasTurn).toBe(false);
    expect(response.body.iceServers).toHaveLength(1);
  });

  it('includes TURN credentials when configured', async () => {
    const user = await registerUser(app);

    env.TURN_URLS = ['turn:relay.example:80'];
    env.TURN_USERNAME = 'turn-user';
    env.TURN_CREDENTIAL = 'turn-secret';

    const response = await request(app)
      .get('/api/rtc/ice-servers')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(response.body.hasTurn).toBe(true);
    expect(response.body.iceServers[1]).toEqual({
      urls: ['turn:relay.example:80'],
      username: 'turn-user',
      credential: 'turn-secret',
    });
  });

  it('treats a partial TURN configuration as no TURN at all', async () => {
    const user = await registerUser(app);

    // Half a configuration would produce an ICE server the browser silently
    // fails to authenticate against.
    env.TURN_URLS = ['turn:relay.example:80'];
    env.TURN_USERNAME = undefined;
    env.TURN_CREDENTIAL = 'turn-secret';

    const response = await request(app)
      .get('/api/rtc/ice-servers')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(response.body.hasTurn).toBe(false);
  });

  it('requires authentication, since a TURN credential is a relay someone pays for', async () => {
    await request(app).get('/api/rtc/ice-servers').expect(401);
  });
});
