import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Load `server/.env` by a path relative to this module, not to the current
 * working directory.
 *
 * `import 'dotenv/config'` resolves `.env` against `process.cwd()`, so the
 * server would only find its config when started from inside `server/` -
 * `node dist/server.js` from the repo root would silently get nothing. This
 * module sits at `<pkg>/src/config` in dev and `<pkg>/dist/config` in the
 * build, so the package root is two levels up in both cases.
 *
 * Real environment variables always win: dotenv never overwrites an existing
 * value, which is what makes Docker, Render and CI (where there is no .env
 * file at all) work unchanged.
 */
loadDotenv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

/** Splits a comma-separated env value into a trimmed, non-empty list. */
const toList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * An optional variable that may legitimately be present but blank.
 *
 * `.optional()` alone only accepts `undefined`, so a `KEY=` line in a .env
 * file - or a blank value in a Render dashboard, which is how an unset
 * variable is usually expressed there - would arrive as `''` and fail
 * validation, refusing to start the server over a setting nobody needed.
 * Blank is normalised to "not set".
 */
const optionalEnvString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

/** A boolean flag written as `true`/`false`, which is all a .env file can say. */
const envFlag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

/** Which implementation of `AIProvider` does the transcription and analysis. */
export const AI_PROVIDERS = ['mock', 'groq', 'gemini'] as const;

/**
 * Environment contract for the server.
 *
 * Working rule: validate at the edge. Config is the very first edge, so the
 * process refuses to boot with a bad/missing variable rather than throwing a
 * confusing `undefined` error somewhere deep in a request handler later.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Render injects PORT; coerce because every process.env value is a string.
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),

  // Comma-separated allowlist -> string[]. Consumed by the CORS middleware.
  CORS_ORIGINS: z.string().default('http://localhost:5173').transform(toList),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Required from Phase 1: the app opens both connections during startup and
  // refuses to serve traffic without them.
  // Kept as plain non-empty strings rather than URL-validated: the real values
  // use non-HTTP schemes (mongodb+srv://, rediss://) that URL validators treat
  // inconsistently.
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required (see server/.env.example)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (see server/.env.example)'),

  // How long graceful shutdown waits for in-flight requests before forcing
  // sockets closed. Render sends SIGTERM and kills the container ~30s later.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // --- Auth -----------------------------------------------------------------

  // Signs access tokens. A short secret makes the signature brute-forceable
  // offline, so the floor is enforced here rather than trusted to a README.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters (try: openssl rand -hex 32)'),

  /** Access-token lifetime in seconds. Short by design; the refresh token carries the session. */
  ACCESS_TOKEN_TTL_SEC: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60),

  /** Refresh-token lifetime in days, and therefore the maximum idle session length. */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  /**
   * How long after a refresh token is rotated a replay is still treated as a
   * concurrent refresh rather than theft.
   *
   * Two browser tabs each run their own JavaScript context, so they refresh
   * independently and will race; without a window, opening a second tab looks
   * exactly like a stolen token. The cost is that a genuinely stolen token is
   * accepted for this long after rotation. Set to 0 to disable.
   */
  REFRESH_REUSE_GRACE_MS: z.coerce.number().int().min(0).default(10_000),

  /**
   * Maximum refresh tokens retained per account, oldest pruned first.
   *
   * Bounds the document size of an account that signs in from many devices
   * or tabs - such as a seeded team-mate every reviewer uses as the second
   * person in a call. Signing in more times than this silently ends the
   * oldest session.
   */
  MAX_SESSIONS_PER_USER: z.coerce.number().int().min(1).max(200).default(20),

  // bcrypt work factor. 12 is the production default (~350ms per hash on this
  // hardware); the test environment lowers it, since hundreds of hashes at
  // cost 12 would add minutes to the suite for no extra assurance.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  /**
   * Email of the seeded "Demo User" persona, which owns the demo team and
   * hosts the sample meetings. `POST /api/auth/demo` does not sign in as it;
   * each demo sign-in gets a guest account of its own.
   */
  DEMO_EMAIL: z.string().default('demo@intellmeet.app'),

  /**
   * How long demo data survives.
   *
   * Teams and meetings created in the demo workspace older than this are
   * swept, and so are guest accounts that have not signed in or refreshed
   * their session for this long (with everything they created). Six hours is
   * long enough that nobody is swept out mid-demo, and short enough that the
   * workspace is presentable again by the next morning.
   */
  DEMO_DATA_TTL_HOURS: z.coerce.number().min(1).max(720).default(6),

  /** How often the cleanup sweep runs, in minutes. */
  DEMO_CLEANUP_INTERVAL_MIN: z.coerce.number().int().min(5).max(1440).default(30),

  /**
   * Most demo guests that may exist at once.
   *
   * "Try Live Demo" is unauthenticated and creates an account, so without a
   * ceiling a script could fill the database and the demo team. The rate
   * limiter bounds one IP; this bounds everyone. At the ceiling new demo
   * sign-ins get a 503 until the sweep has removed inactive guests.
   */
  DEMO_MAX_GUESTS: z.coerce.number().int().min(1).max(10_000).default(200),

  // --- Rate limits for a crowd behind one address ---------------------------
  //
  // Reviewers on one college or office network share a public IP, and every
  // per-IP limit is shared between them. Register and sign-in stay tight
  // (they hash passwords); these two are sized for a room of people.

  /**
   * "Try Live Demo" sign-ins per IP per 15 minutes. Each reviewer makes one
   * or two (a second window to meet themselves in a call).
   */
  RATE_LIMIT_DEMO_PER_15_MIN: z.coerce.number().int().min(1).max(10_000).default(60),

  /**
   * Session refreshes per IP per 15 minutes. Every page load makes one, and
   * every open tab one more each quarter of an hour.
   */
  RATE_LIMIT_REFRESH_PER_15_MIN: z.coerce.number().int().min(1).max(100_000).default(600),

  /**
   * Register and password sign-in per IP per 15 minutes. Each hashes a
   * password; each reviewer signs in as a seeded team-mate for the second
   * window of a call.
   */
  RATE_LIMIT_AUTH_PER_15_MIN: z.coerce.number().int().min(1).max(10_000).default(30),

  /**
   * Failed sign-ins per IP *and* email per 15 minutes. A room on one network
   * shares this budget for each seeded team-mate, so a few typos by several
   * people add up. (A separate limit of 30 per account, whatever the address,
   * is fixed: it is the one that must hold against a determined guesser.)
   */
  RATE_LIMIT_LOGIN_FAILURES_PER_15_MIN: z.coerce.number().int().min(1).max(1_000).default(5),

  // --- Live meetings ----------------------------------------------------------

  /**
   * A live meeting nobody has been connected to for this many minutes is
   * ended automatically. Closing the tab, a crash or a server restart never
   * sends "End", and without this the meeting would show as Live forever.
   * The check runs every five minutes, so one ends 10-15 minutes after the
   * last person left at the default.
   */
  LIVE_MEETING_IDLE_MIN: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(10),

  /**
   * The seeded demo board's sample tasks are put back where the seed left
   * them once the board has been quiet (no task created, changed or moved)
   * for this many minutes. Reviewers share the board, so moves are expected;
   * this keeps the next reviewer's first look tidy without ever resetting
   * a board somebody is using.
   */
  DEMO_BOARD_RESET_IDLE_MIN: z.coerce
    .number()
    .int()
    .min(1)
    .max(7 * 24 * 60)
    .default(60),

  // --- Cloudinary (optional) ------------------------------------------------
  // The app runs fully without these; only the upload-signature endpoint is
  // disabled, and it reports SERVICE_UNAVAILABLE rather than failing obscurely.
  CLOUDINARY_CLOUD_NAME: optionalEnvString,
  CLOUDINARY_API_KEY: optionalEnvString,
  CLOUDINARY_API_SECRET: optionalEnvString,

  /** Base URL of the web client, used to build shareable invite links. */
  CLIENT_URL: z.string().default('http://localhost:5173'),

  // --- WebRTC ICE servers ---------------------------------------------------

  /**
   * STUN servers. Google's are free and public; STUN only reveals a peer's own
   * public address, so there is no credential and no bandwidth cost.
   */
  STUN_URLS: z
    .string()
    .default('stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
    .transform(toList),

  /**
   * TURN relay (Metered's free tier). Optional: without it, calls still work
   * on most networks but fail behind symmetric NATs and strict firewalls.
   * The credential is served per call from the backend and never bundled.
   */
  TURN_URLS: optionalEnvString.pipe(z.string().transform(toList).optional()),
  TURN_USERNAME: optionalEnvString,
  TURN_CREDENTIAL: optionalEnvString,

  // --- Recording + AI pipeline (Phase 6) -----------------------------------

  /**
   * `mock` needs no account and returns deterministic output derived from the
   * transcript, so the whole pipeline runs offline and in tests. `gemini` is
   * the production provider (Groq, the plan's first choice, is unreachable
   * from the development network); `groq` remains supported. With `groq`
   * selected and a Gemini key also present, Gemini becomes the automatic
   * fallback.
   */
  AI_PROVIDER: z.enum(AI_PROVIDERS).default('mock'),

  GROQ_API_KEY: optionalEnvString,
  GROQ_TRANSCRIBE_MODEL: z.string().default('whisper-large-v3'),
  GROQ_CHAT_MODEL: z.string().default('llama-3.3-70b-versatile'),

  GEMINI_API_KEY: optionalEnvString,
  /**
   * A current free-tier Flash model that accepts audio. Not the newest one on
   * purpose: at Phase 11 the two newest Flash models answered "high demand"
   * (503) to free-tier keys for minutes at a time, while this one answered.
   * The 2.5 family is restricted to projects that used it before.
   */
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  /**
   * Tried in order when GEMINI_MODEL still fails after its in-call retry
   * (overloaded, out of quota, retired). The free tier allows 20 requests a
   * day per model (measured at Phase 11), and a recorded meeting takes at
   * least two, so each model in the chain adds about ten meetings a day; each
   * also has its own load. Comma-separated; `none` turns the chain off.
   */
  GEMINI_FALLBACK_MODELS: z
    .string()
    .default('gemini-3.6-flash,gemini-3.7-flash,gemini-3.8-flash')
    .transform((value) => (value.trim() === 'none' ? [] : toList(value))),

  /**
   * Largest audio file sent to the provider in one request. Groq's limit is
   * 25 MB on the free tier; anything bigger is split with ffmpeg first.
   */
  AI_MAX_FILE_MB: z.coerce.number().positive().max(100).default(24),

  /** Chunk length, in seconds, when a recording has to be split. */
  AI_CHUNK_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),

  /** Attempts per job, with exponential backoff starting at AI_JOB_BACKOFF_MS. */
  AI_JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  AI_JOB_BACKOFF_MS: z.coerce.number().int().min(100).default(10_000),

  /**
   * Run the BullMQ worker inside the web process. Render's free tier has no
   * background workers, so this is how production runs; set false when a
   * separate `npm run worker` process consumes the queue instead.
   */
  RUN_WORKER_IN_PROCESS: envFlag(true),

  /**
   * Where recordings live when Cloudinary is not configured. Relative paths
   * resolve against the server package. Local disk is fine for development;
   * on Render it is ephemeral, which is why production wants Cloudinary.
   */
  RECORDINGS_DIR: z.string().default('.data/recordings'),

  /** Upload ceiling for the server-side recording path. ~2h at 32 kbps. */
  MAX_RECORDING_MB: z.coerce.number().positive().max(200).default(50),

  /** Overrides the bundled ffmpeg binary, e.g. with a system install. */
  FFMPEG_PATH: optionalEnvString,
});

export type Env = z.infer<typeof envSchema>;

/**
 * Cross-field rules zod cannot express per field: choosing a real AI provider
 * without its key would otherwise boot fine and fail on the first meeting.
 */
function providerKeyIssues(env: Env): string[] {
  const issues: string[] = [];
  if (env.AI_PROVIDER === 'groq' && !env.GROQ_API_KEY) {
    issues.push('  - GROQ_API_KEY: required when AI_PROVIDER=groq');
  }
  if (env.AI_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
    issues.push('  - GEMINI_API_KEY: required when AI_PROVIDER=gemini');
  }
  return issues;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  const crossFieldIssues = parsed.success ? providerKeyIssues(parsed.data) : [];

  if (!parsed.success || crossFieldIssues.length > 0) {
    const details = [
      ...(parsed.success
        ? []
        : parsed.error.issues.map(
            (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
          )),
      ...crossFieldIssues,
    ].join('\n');

    console.error(
      `\n[env] Invalid environment configuration:\n${details}\n\n` +
        `Copy server/.env.example to server/.env and fill in the values.\n`,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
