import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { healthResponseSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';

describe('GET /api/health', () => {
  const app = createApp();

  it('returns 200 with a payload matching the shared contract', async () => {
    const response = await request(app).get('/api/health').expect(200);

    // Asserting against the shared schema means this test also protects the
    // client, which decodes the same response with the same schema.
    const parsed = healthResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('intellmeet-server');
  });
});
