import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { healthResponseSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { setRedisClient } from '../../config/redis.js';
import { fakeRedis } from '../../test/setup.js';

describe('health endpoints', () => {
  const app = createApp();

  afterEach(() => {
    // Some tests knock Redis out; restore the stub for the next one.
    setRedisClient(fakeRedis);
  });

  describe('GET /api/health', () => {
    it('reports ok with mongo and redis up', async () => {
      const response = await request(app).get('/api/health').expect(200);

      const parsed = healthResponseSchema.safeParse(response.body);
      expect(parsed.success).toBe(true);

      expect(response.body.status).toBe('ok');
      expect(response.body.service).toBe('intellmeet-server');
      expect(response.body.environment).toBe('test');
      expect(response.body.dependencies.mongo.status).toBe('up');
      expect(response.body.dependencies.redis.status).toBe('up');
      expect(response.body.dependencies.mongo.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('stays 200 but reports degraded when redis is down', async () => {
      setRedisClient(null);

      const response = await request(app).get('/api/health').expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.dependencies.redis.status).toBe('down');
      expect(response.body.dependencies.redis.error).toBeTruthy();
      // Mongo is unaffected: one dependency failing must not mask the others.
      expect(response.body.dependencies.mongo.status).toBe('up');
    });

    it('echoes a correlation id on the response', async () => {
      const response = await request(app).get('/api/health').expect(200);
      expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,}$/);
    });
  });

  describe('GET /api/health/ready', () => {
    it('returns 200 when every dependency is up', async () => {
      const response = await request(app).get('/api/health/ready').expect(200);
      expect(response.body.status).toBe('ok');
    });

    it('returns 503 when a dependency is down, so the instance leaves rotation', async () => {
      setRedisClient(null);

      const response = await request(app).get('/api/health/ready').expect(503);
      expect(response.body.status).toBe('degraded');
    });
  });
});
