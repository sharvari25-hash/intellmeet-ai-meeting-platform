import type { Request, RequestHandler } from 'express';
import rateLimit, { MemoryStore, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../config/redis.js';
import { isTest } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/**
 * Normalises a client address into a rate-limit bucket.
 *
 * IPv4 is used whole. IPv6 is truncated to its /64 prefix, because a single
 * residential or cloud customer is routinely handed an entire /64 - keying on
 * the full address would let one attacker mint effectively unlimited distinct
 * buckets and walk straight past the limit.
 */
function ipBucket(req: Request): string {
  const ip = req.ip ?? 'unknown';

  // Express reports IPv4 over IPv6 sockets as "::ffff:127.0.0.1".
  const mapped = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  if (!mapped.includes(':')) return mapped;

  return mapped.split(':').slice(0, 4).join(':');
}

/**
 * Chooses where counters live.
 *
 * Redis in development and production, so the limit holds across every Render
 * instance rather than per-process (a multi-instance deployment with in-memory
 * counters silently multiplies every limit by the instance count).
 *
 * Under test, the library's in-memory store: the suite must not require a live
 * Redis, and per-process counters are exactly right when each test file is its
 * own process.
 */
/**
 * In-memory stores created under test, kept so the suite can clear them.
 *
 * Counters are module-level state that survives between tests in a file, so
 * without a reset the first test to exhaust a limit would 429 every test after
 * it - and the failure would look like a bug in whichever endpoint ran next.
 */
const testStores: MemoryStore[] = [];

/**
 * Test-only: clears every in-memory counter.
 *
 * Called from the global `afterEach`, so each test starts with a clean budget
 * and rate-limit behaviour can still be asserted explicitly where it matters.
 */
export function resetRateLimits(): void {
  for (const store of testStores) store.resetAll();
}

function createStore(prefix: string): Store | undefined {
  if (isTest) {
    const store = new MemoryStore();
    testStores.push(store);
    return store;
  }

  return new RedisStore({
    prefix: `rl:${prefix}:`,
    // rate-limit-redis speaks node-redis by default; this adapts it to ioredis,
    // which is what the rest of the app (and BullMQ in Phase 6) already uses.
    sendCommand: async (...args: string[]): Promise<never> => {
      const [command, ...rest] = args;
      if (!command) throw new Error('rate-limit-redis issued an empty command');
      return getRedis().call(command, ...rest) as Promise<never>;
    },
  });
}

interface LimiterOptions {
  prefix: string;
  windowMs: number;
  limit: number;
  message: string;
  keyGenerator?: (req: Request) => string;
}

function buildLimiter({
  prefix,
  windowMs,
  limit,
  message,
  keyGenerator,
}: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    // Draft-7 `RateLimit` headers; the legacy `X-RateLimit-*` set is off.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createStore(prefix),
    keyGenerator: keyGenerator ?? ipBucket,
    // Route the rejection through the central error handler so a 429 has the
    // same `{ error: { code, message, requestId } }` body as everything else.
    handler: (_req, _res, next) => {
      next(AppError.tooManyRequests(message));
    },
  });
}

/**
 * Builds the limiter on its first request rather than at import time.
 *
 * This is not premature laziness - it is required. `RedisStore`'s constructor
 * issues a Redis command straight away to load its increment script, but the
 * limiters below are module-level constants, evaluated when `app.ts` imports
 * the routers. That happens *before* `bootstrap()` has called
 * `connectRedis()`, so eager construction crashes the process on startup with
 * "Redis client is not connected".
 *
 * By the time a request can arrive, the server is listening, which only
 * happens after both connections are established.
 */
function createLimiter(options: LimiterOptions): RequestHandler {
  let limiter: RequestHandler | undefined;

  return (req, res, next) => {
    limiter ??= buildLimiter(options);
    limiter(req, res, next);
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * Login limiter: 5 attempts per 15 minutes per IP **and** email.
 *
 * Keying on both is what makes this useful. IP alone punishes everyone behind
 * a corporate NAT when one colleague fat-fingers a password; email alone lets
 * an attacker lock a known victim out of their own account by deliberately
 * failing. The pair throttles credential stuffing against one account while
 * leaving other users on the same IP unaffected.
 *
 * Mounted after `express.json()`, so `req.body` is already parsed - but it is
 * read defensively, because the limiter runs *before* validation and the body
 * may be absent or malformed.
 */
export const loginLimiter = createLimiter({
  prefix: 'login',
  windowMs: FIFTEEN_MINUTES,
  limit: 5,
  message: 'Too many sign-in attempts. Please try again in 15 minutes.',
  keyGenerator: (req) => {
    const body = req.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    return `${ipBucket(req)}|${email}`;
  },
});

/**
 * Broader limiter for the remaining auth routes (register, refresh, demo,
 * logout), keyed on IP only. Generous enough not to interrupt real use, tight
 * enough to stop scripted account creation and refresh-token probing.
 */
export const authLimiter = createLimiter({
  prefix: 'auth',
  windowMs: FIFTEEN_MINUTES,
  limit: 30,
  message: 'Too many requests. Please try again shortly.',
});

/** Limiter for authenticated write-heavy routes such as creating teams and invites. */
export const writeLimiter = createLimiter({
  prefix: 'write',
  windowMs: 60 * 1000,
  limit: 30,
  message: 'Too many requests. Please slow down.',
});
