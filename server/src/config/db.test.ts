import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo, pingMongo, redactMongoUri, withTimeout } from './db.js';

/** Provided by the in-memory MongoDB started in globalSetup. */
const testUri = (): string => process.env.MONGODB_URI as string;

describe('redactMongoUri', () => {
  it('removes credentials so a URI is safe to log', () => {
    const redacted = redactMongoUri('mongodb+srv://admin:s3cret@cluster0.mongodb.net/intellmeet');
    expect(redacted).toBe('mongodb+srv://<credentials>@cluster0.mongodb.net/intellmeet');
    expect(redacted).not.toContain('s3cret');
  });

  it('leaves a credential-free URI unchanged', () => {
    const uri = 'mongodb://localhost:27017/intellmeet';
    expect(redactMongoUri(uri)).toBe(uri);
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('done'), 1_000, 'too slow')).resolves.toBe('done');
  });

  it('rejects with the given message when the promise hangs', async () => {
    const hangs = new Promise<never>(() => {});
    await expect(withTimeout(hangs, 20, 'too slow')).rejects.toThrow('too slow');
  });
});

describe('pingMongo', () => {
  it('reports up with a latency while connected', async () => {
    // The shared in-memory server is already connected by the test setup.
    const health = await pingMongo();

    expect(health.status).toBe('up');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.error).toBeUndefined();
  });

  it('reports down with the readyState once disconnected', async () => {
    await mongoose.disconnect();

    const health = await pingMongo();
    expect(health.status).toBe('down');
    expect(health.error).toContain('readyState=');

    // Restore the connection for the rest of the file.
    await connectMongo({ uri: testUri(), retries: 1 });
    expect(mongoose.connection.readyState).toBe(1);
  });
});

describe('connectMongo', () => {
  it('gives up after the configured number of attempts on an unreachable host', async () => {
    await mongoose.disconnect();

    // Port 1 is reserved, so nothing will ever answer there.
    await expect(
      connectMongo({ uri: 'mongodb://127.0.0.1:1/nope', retries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow();

    // Reconnect so the afterEach cleanup and later tests still work.
    await connectMongo({ uri: testUri(), retries: 1 });
    expect(mongoose.connection.readyState).toBe(1);
  }, 40_000);
});
