import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { mongoSanitize, preventParameterPollution } from './sanitize.js';

/** Echoes back whatever the middleware left on the request. */
function appWith(...middleware: express.RequestHandler[]): Express {
  const app = express();
  app.use(express.json());
  app.use(...middleware);
  app.all('/echo{/:id}', (req, res) => {
    res.json({ body: req.body, query: req.query, params: req.params });
  });
  return app;
}

describe('mongoSanitize', () => {
  it('strips $-prefixed operator keys from the body', async () => {
    const response = await request(appWith(mongoSanitize))
      .post('/echo')
      .send({ email: { $ne: null }, password: 'hunter2' })
      .expect(200);

    // Without this, `{ $ne: null }` would match the first user in the
    // collection and hand back an authenticated session.
    expect(response.body.body).toEqual({ email: {}, password: 'hunter2' });
  });

  it('strips dotted keys that reach into nested paths', async () => {
    const response = await request(appWith(mongoSanitize))
      .post('/echo')
      .send({ 'user.role': 'admin', name: 'Ada' })
      .expect(200);

    expect(response.body.body).toEqual({ name: 'Ada' });
  });

  it('strips bracket-encoded operator keys from the query string', async () => {
    const response = await request(appWith(mongoSanitize))
      .get('/echo?role[$ne]=member&team=alpha')
      .expect(200);

    // Express 5's default `simple` query parser does not nest, so this arrives
    // as the flat key `role[$ne]` and must be dropped whole.
    expect(response.body.query).toEqual({ team: 'alpha' });
  });

  it('drops prototype-pollution keys', async () => {
    const response = await request(appWith(mongoSanitize))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"isAdmin":true},"name":"Ada"}')
      .expect(200);

    expect(response.body.body).toEqual({ name: 'Ada' });
    expect({}).not.toHaveProperty('isAdmin');
  });

  it('leaves legitimate nested data and arrays intact', async () => {
    const payload = { title: 'Standup', tags: ['daily', 'team'], meta: { durationMin: 15 } };
    const response = await request(appWith(mongoSanitize)).post('/echo').send(payload).expect(200);

    expect(response.body.body).toEqual(payload);
  });
});

describe('preventParameterPollution', () => {
  it('collapses a repeated query parameter to its last value', async () => {
    const response = await request(appWith(preventParameterPollution()))
      .get('/echo?role=member&role=admin')
      .expect(200);

    expect(response.body.query.role).toBe('admin');
  });

  it('keeps whitelisted parameters as arrays', async () => {
    const response = await request(appWith(preventParameterPollution({ whitelist: ['tag'] })))
      .get('/echo?tag=a&tag=b&role=member&role=admin')
      .expect(200);

    expect(response.body.query.tag).toEqual(['a', 'b']);
    expect(response.body.query.role).toBe('admin');
  });

  it('leaves a single-valued query untouched', async () => {
    const response = await request(appWith(preventParameterPollution()))
      .get('/echo?page=2')
      .expect(200);

    expect(response.body.query).toEqual({ page: '2' });
  });

  it('does not collapse arrays in a JSON body', async () => {
    // JSON bodies legitimately contain arrays, unlike query strings.
    const response = await request(appWith(preventParameterPollution()))
      .post('/echo')
      .send({ memberIds: ['a', 'b'] })
      .expect(200);

    expect(response.body.body.memberIds).toEqual(['a', 'b']);
  });
});

describe('the two middlewares composed, in pipeline order', () => {
  it('sanitises and then de-pollutes the same request', async () => {
    const response = await request(appWith(mongoSanitize, preventParameterPollution()))
      .get('/echo?role=member&role=admin&sort[$gt]=1')
      .expect(200);

    // mongoSanitize removes the operator key, then hpp collapses the duplicate.
    expect(response.body.query).toEqual({ role: 'admin' });
  });
});
