import type { Request, RequestHandler } from 'express';
import rateLimit, { MemoryStore, type Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from '../config/redis.js';
import { env, isTest } from '../config/env.js';
import { clientIp } from '../lib/clientIp.js';
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
  // The visitor, not the proxy in front of us: see lib/clientIp.ts.
  const ip = clientIp(req);

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
  /** A function when the ceiling comes from configuration, read per request. */
  limit: number | (() => number);
  message: string;
  keyGenerator?: (req: Request) => string;
  /** Count only requests that fail (status >= 400). */
  skipSuccessfulRequests?: boolean;
}

function buildLimiter({
  prefix,
  windowMs,
  limit,
  message,
  keyGenerator,
  skipSuccessfulRequests = false,
}: LimiterOptions): RequestHandler {
  return rateLimit({
    windowMs,
    limit: typeof limit === 'number' ? limit : () => limit(),
    skipSuccessfulRequests,
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
 * The email a sign-in is for, normalised as accounts store it.
 *
 * Mounted after `express.json()`, so `req.body` is already parsed - but it is
 * read defensively, because the limiters run *before* validation and the body
 * may be absent or malformed.
 */
function loginEmail(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
}

/**
 * Login limiter: *failed* attempts per 15 minutes per IP **and** email
 * (`RATE_LIMIT_LOGIN_FAILURES_PER_15_MIN`, default 5).
 *
 * Keying on both is what makes this useful. IP alone punishes everyone behind
 * a corporate NAT when one colleague fat-fingers a password; email alone lets
 * an attacker lock a known victim out of their own account by deliberately
 * failing. The pair throttles credential stuffing against one account while
 * leaving other users on the same IP unaffected.
 *
 * Only failures count. A correct password is not a guess, and counting it
 * meant five people in one room signing in as the same seeded team-mate
 * locked the sixth out for a quarter of an hour. Adjustable because a room of
 * reviewers on one network shares this budget for each seeded team-mate.
 */
export const loginLimiter = createLimiter({
  prefix: 'login',
  windowMs: FIFTEEN_MINUTES,
  limit: () => env.RATE_LIMIT_LOGIN_FAILURES_PER_15_MIN,
  skipSuccessfulRequests: true,
  message: 'Too many sign-in attempts. Please try again in 15 minutes.',
  keyGenerator: (req) => `${ipBucket(req)}|${loginEmail(req)}`,
});

/** Failed sign-ins for one account from everywhere at once, per 15 minutes. */
export const ACCOUNT_LOGIN_FAILURES_PER_15_MIN = 30;

/**
 * Failed sign-ins per account, whatever the address.
 *
 * The limiter above is keyed on the caller's IP, and in production a caller
 * who bypasses the Vercel rewrite can choose the address the API sees
 * (lib/clientIp.ts). This one ignores the address entirely, so guessing one
 * account's password stays slow however many addresses are claimed. It is
 * set well above what a person or a room of people mistyping produces; the
 * price is that someone failing on purpose 30 times can hold an account shut
 * for 15 minutes, which is why it is not the only limit.
 */
export const accountLoginLimiter = createLimiter({
  prefix: 'login-account',
  windowMs: FIFTEEN_MINUTES,
  limit: ACCOUNT_LOGIN_FAILURES_PER_15_MIN,
  skipSuccessfulRequests: true,
  message: 'Too many failed sign-ins for this account. Please try again in 15 minutes.',
  keyGenerator: (req) => `email:${loginEmail(req)}`,
});

/**
 * Register and sign-in, per IP (`RATE_LIMIT_AUTH_PER_15_MIN`, default 30).
 *
 * Both hash a password (bcrypt: ~350ms of CPU at cost 12, far longer on a
 * small shared CPU), and register creates an account, so this is the tight
 * one. Every request counts, successful or not: the cost being bounded is the
 * hashing itself. Adjustable because reviewers on one network each sign in as
 * a seeded team-mate for the second window of a call.
 */
export const authLimiter = createLimiter({
  prefix: 'auth',
  windowMs: FIFTEEN_MINUTES,
  limit: () => env.RATE_LIMIT_AUTH_PER_15_MIN,
  message: 'Too many requests. Please try again shortly.',
});

/**
 * "Try Live Demo", per IP (`RATE_LIMIT_DEMO_PER_15_MIN`, default 60).
 *
 * Its own budget, because several reviewers behind one college or office NAT
 * share an address, and each makes one or two demo sign-ins (a second window
 * to meet themselves in a call). No password is hashed, so it is cheap; it
 * creates an account, so it is bounded twice: per address here, and for
 * everyone at once by `DEMO_MAX_GUESTS`.
 */
export const demoLimiter = createLimiter({
  prefix: 'demo',
  windowMs: FIFTEEN_MINUTES,
  limit: () => env.RATE_LIMIT_DEMO_PER_15_MIN,
  message: 'Too many demo sign-ins from this network. Please try again in a few minutes.',
});

/**
 * Session refresh, per IP (`RATE_LIMIT_REFRESH_PER_15_MIN`, default 600).
 *
 * Every page load makes one (the access token lives in memory, so a reload
 * swaps the cookie for a new one), and every open tab one more each quarter
 * of an hour. Behind a shared address that adds up quickly, and a rejected
 * refresh looks to the person like being signed out.
 *
 * There is nothing to guess: a refresh token is 256 random bits, so the limit
 * only bounds a runaway client or a flood, and can be generous. It stays
 * per IP rather than per session because the token rotates on every call -
 * the only stable session key, the family id, is known only after the
 * database lookup this is meant to protect, and keying on the raw cookie
 * would give every forged value a fresh bucket.
 */
export const refreshLimiter = createLimiter({
  prefix: 'refresh',
  windowMs: FIFTEEN_MINUTES,
  limit: () => env.RATE_LIMIT_REFRESH_PER_15_MIN,
  message: 'Too many requests. Please try again shortly.',
});

/** Limiter for authenticated write-heavy routes such as creating teams and invites. */
export const writeLimiter = createLimiter({
  prefix: 'write',
  windowMs: 60 * 1000,
  limit: 30,
  message: 'Too many requests. Please slow down.',
});

/**
 * Board edits - creating, editing, moving and commenting on tasks - per
 * signed-in account: 120 a minute.
 *
 * Keyed on the account, not the address. Dragging cards around is fast and
 * bursty, and a room of reviewers on one network would share a per-IP budget
 * the way they used to share the auth one. Every route behind it requires a
 * token, so the account is known; the address is only a fallback.
 */
export const boardWriteLimiter = createLimiter({
  prefix: 'board',
  windowMs: 60 * 1000,
  limit: 120,
  message: 'You are changing the board very quickly. Please slow down.',
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipBucket(req)),
});

/**
 * Analytics reads, per signed-in account: 120 a minute.
 *
 * Reads, but not free ones: the answers are cached, and a range nobody has
 * asked for yet is a miss that runs the aggregations. This bounds how many
 * one person can start. The dashboard makes three requests per change of
 * filter, so a person clicking through ranges never meets it.
 */
export const analyticsLimiter = createLimiter({
  prefix: 'analytics',
  windowMs: 60 * 1000,
  limit: 120,
  message: 'Too many analytics requests. Please wait a moment.',
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipBucket(req)),
});
