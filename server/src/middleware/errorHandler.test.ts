import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { z } from 'zod';
import { apiErrorSchema } from '@intellmeet/shared';
import { createApp } from '../app.js';
import { AppError } from '../lib/errors.js';
import { errorHandler, toAppError } from './errorHandler.js';
import { requestId } from './requestId.js';

/** Minimal app that throws whatever the test provides, then handles it. */
function appThatThrows(error: unknown) {
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '1kb' }));
  app.get('/boom', () => {
    throw error;
  });
  app.post('/echo', (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = AppError.notFound('Meeting not found');
    expect(toAppError(original)).toBe(original);
  });

  it('maps a ZodError to VALIDATION_ERROR with field details', () => {
    const result = z.object({ email: z.email() }).safeParse({ email: 'nope' });
    expect(result.success).toBe(false);

    const appError = toAppError(result.success ? null : result.error);
    expect(appError.code).toBe('VALIDATION_ERROR');
    expect(appError.status).toBe(400);
    expect(appError.details?.[0]?.path).toBe('email');
  });

  it('maps a mongo duplicate-key error to CONFLICT naming the field', () => {
    const duplicate = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyValue: { email: 'taken@example.com' },
    });

    const appError = toAppError(duplicate);
    expect(appError.code).toBe('CONFLICT');
    expect(appError.status).toBe(409);
    expect(appError.message).toContain('email');
  });

  it('maps an oversized body to PAYLOAD_TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
    });
    expect(toAppError(tooLarge).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps malformed JSON to BAD_REQUEST', () => {
    const parseFailed = Object.assign(new SyntaxError('Unexpected token'), {
      type: 'entity.parse.failed',
    });
    expect(toAppError(parseFailed).code).toBe('BAD_REQUEST');
  });

  it('treats anything unrecognised as INTERNAL_ERROR and keeps the cause', () => {
    const raw = new Error('something exploded in a library');
    const appError = toAppError(raw);

    expect(appError.code).toBe('INTERNAL_ERROR');
    expect(appError.status).toBe(500);
    expect(appError.cause).toBe(raw);
  });
});

describe('errorHandler', () => {
  it('renders the shared ApiError shape with a request id', async () => {
    const response = await request(appThatThrows(AppError.forbidden('Not your team')))
      .get('/boom')
      .expect(403);

    const parsed = apiErrorSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(response.body.error.message).toBe('Not your team');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('includes field details on a validation error', async () => {
    const error = AppError.validation([{ path: 'body.email', message: 'Invalid email' }]);
    const response = await request(appThatThrows(error)).get('/boom').expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([{ path: 'body.email', message: 'Invalid email' }]);
  });

  it('omits details when there are none', async () => {
    const response = await request(appThatThrows(AppError.notFound())).get('/boom').expect(404);
    expect(response.body.error).not.toHaveProperty('details');
  });

  it('converts a thrown non-Error value into a 500', async () => {
    const response = await request(appThatThrows('a bare string')).get('/boom').expect(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('rejects a body over the json limit with PAYLOAD_TOO_LARGE', async () => {
    const response = await request(appThatThrows(new Error('unused')))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(4096) }))
      .expect(413);

    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects malformed JSON with BAD_REQUEST', async () => {
    const response = await request(appThatThrows(new Error('unused')))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"unclosed":')
      .expect(400);

    expect(response.body.error.code).toBe('BAD_REQUEST');
  });
});

describe('404 handling on the real app', () => {
  it('returns the ApiError shape for an unknown route', async () => {
    const response = await request(createApp()).get('/api/does-not-exist').expect(404);

    expect(apiErrorSchema.safeParse(response.body).success).toBe(true);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('/api/does-not-exist');
  });

  it('sets security headers from helmet even on an error response', async () => {
    const response = await request(createApp()).get('/api/does-not-exist').expect(404);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers).not.toHaveProperty('x-powered-by');
  });
});
