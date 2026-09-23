import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { z } from 'zod';
import { errorHandler } from './errorHandler.js';
import { requestId } from './requestId.js';
import { validate, type ValidationSchemas } from './validate.js';

function appWith(schemas: ValidationSchemas): Express {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.post('/things{/:id}', validate(schemas), (req, res) => {
    res.json({ body: req.body, query: req.query, params: req.params });
  });
  app.use(errorHandler);
  return app;
}

const bodySchema = z.object({
  title: z.string().min(3),
  email: z.email(),
});

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

describe('validate', () => {
  it('passes a valid request through', async () => {
    const response = await request(appWith({ body: bodySchema }))
      .post('/things')
      .send({ title: 'Standup', email: 'ada@example.com' })
      .expect(200);

    expect(response.body.body).toEqual({ title: 'Standup', email: 'ada@example.com' });
  });

  it('rejects an invalid body with VALIDATION_ERROR and prefixed paths', async () => {
    const response = await request(appWith({ body: bodySchema }))
      .post('/things')
      .send({ title: 'no', email: 'not-an-email' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('body.title');
    expect(paths).toContain('body.email');
  });

  it('reports problems across body and query in a single response', async () => {
    // One round trip tells the caller everything that is wrong, instead of
    // making them fix one field at a time.
    const response = await request(appWith({ body: bodySchema, query: querySchema }))
      .post('/things?page=0')
      .send({ title: 'no', email: 'ada@example.com' })
      .expect(400);

    const paths = response.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toContain('body.title');
    expect(paths).toContain('query.page');
  });

  it('writes the coerced value back, so handlers receive real numbers', async () => {
    const response = await request(appWith({ query: querySchema }))
      .post('/things?page=3&limit=50')
      .send({})
      .expect(200);

    expect(response.body.query).toEqual({ page: 3, limit: 50 });
    expect(typeof response.body.query.page).toBe('number');
  });

  it('applies schema defaults to a missing query', async () => {
    const response = await request(appWith({ query: querySchema }))
      .post('/things')
      .send({})
      .expect(200);

    expect(response.body.query).toEqual({ page: 1, limit: 20 });
  });

  it('validates route params', async () => {
    const paramsSchema = z.object({ id: z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id') });

    await request(appWith({ params: paramsSchema }))
      .post('/things/not-an-id')
      .send({})
      .expect(400);

    await request(appWith({ params: paramsSchema }))
      .post('/things/507f1f77bcf86cd799439011')
      .send({})
      .expect(200);
  });

  it('strips unknown body keys, so clients cannot smuggle extra fields', async () => {
    const response = await request(appWith({ body: bodySchema }))
      .post('/things')
      .send({ title: 'Standup', email: 'ada@example.com', role: 'admin' })
      .expect(200);

    // zod objects are strip-by-default: a mass-assignment attempt on `role`
    // never reaches the handler.
    expect(response.body.body).not.toHaveProperty('role');
  });
});
