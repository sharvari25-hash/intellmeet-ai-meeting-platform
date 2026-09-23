import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { v2 as cloudinary } from 'cloudinary';
import { uploadSignatureSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { bearer, registerUser } from '../../test/fixtures.js';

const app = createApp();

/**
 * Cloudinary is "mocked" by configuration rather than by stubbing the module:
 * the suite runs with throwaway credentials from `vitest.config.ts`, and
 * signing is a pure local computation, so no network call is ever made. That
 * makes the assertions stronger than a stub would - the signature is checked
 * against the real algorithm rather than against a hand-written fake of it.
 *
 * The overrides below target the parsed `env` object, not `process.env`:
 * `env` is built once at import time, so mutating the raw environment
 * afterwards would have no effect.
 */
const ORIGINAL = {
  cloudName: env.CLOUDINARY_CLOUD_NAME,
  apiKey: env.CLOUDINARY_API_KEY,
  apiSecret: env.CLOUDINARY_API_SECRET,
};

afterEach(() => {
  env.CLOUDINARY_CLOUD_NAME = ORIGINAL.cloudName;
  env.CLOUDINARY_API_KEY = ORIGINAL.apiKey;
  env.CLOUDINARY_API_SECRET = ORIGINAL.apiSecret;
});

describe('GET /api/uploads/signature', () => {
  it('returns signed parameters for an avatar upload', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/uploads/signature')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(uploadSignatureSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.folder).toBe('intellmeet/avatars');
    expect(response.body.uploadUrl).toBe('https://api.cloudinary.com/v1_1/test-cloud/image/upload');
    expect(response.body.context).toBe(`uploadedBy=${user.id}`);
  });

  it('routes recordings to the video endpoint and their own folder', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/uploads/signature?kind=recording')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(response.body.folder).toBe('intellmeet/recordings');
    expect(response.body.uploadUrl).toContain('/video/upload');
  });

  it('produces a signature that verifies against the signed parameter set', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/uploads/signature')
      .set('Authorization', bearer(user))
      .expect(200);

    // Recomputing from the returned fields proves the browser can reproduce
    // exactly what was signed - the usual cause of Cloudinary rejecting an
    // upload is a parameter that was signed but not returned to the client.
    const expected = cloudinary.utils.api_sign_request(
      {
        folder: response.body.folder,
        timestamp: response.body.timestamp,
        context: response.body.context,
      },
      'test-api-secret',
    );

    expect(response.body.signature).toBe(expected);
  });

  it('never leaks the API secret', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/uploads/signature')
      .set('Authorization', bearer(user))
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('test-api-secret');
    expect(response.body.apiKey).toBe('123456789012345');
  });

  it('rejects an unknown asset kind', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get('/api/uploads/signature?kind=malware')
      .set('Authorization', bearer(user))
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication, since a signature is a write credential', async () => {
    await request(app).get('/api/uploads/signature').expect(401);
  });

  it('reports SERVICE_UNAVAILABLE when Cloudinary is not configured', async () => {
    const user = await registerUser(app);

    // Simulates a deployment with no Cloudinary account yet.
    env.CLOUDINARY_CLOUD_NAME = undefined;
    env.CLOUDINARY_API_KEY = undefined;
    env.CLOUDINARY_API_SECRET = undefined;

    const response = await request(app)
      .get('/api/uploads/signature')
      .set('Authorization', bearer(user))
      .expect(503);

    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).toContain('Cloudinary');
  });

  it('treats a partial configuration as unconfigured', async () => {
    const user = await registerUser(app);

    // A half-set configuration would otherwise produce signatures Cloudinary
    // rejects with an opaque error.
    env.CLOUDINARY_API_SECRET = undefined;

    await request(app).get('/api/uploads/signature').set('Authorization', bearer(user)).expect(503);
  });
});
