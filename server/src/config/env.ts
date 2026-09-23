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

/**
 * Environment contract for the server.
 *
 * Working rule: validate at the edge. Config is the very first edge, so the
 * process refuses to boot with a bad/missing variable rather than throwing a
 * confusing `undefined` error somewhere deep in a request handler later.
 */
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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Render injects PORT; coerce because every process.env value is a string.
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),

  // Comma-separated allowlist -> string[]. Consumed by the CORS middleware.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),

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

  // bcrypt work factor. 12 is the production default (~350ms per hash on this
  // hardware); the test environment lowers it, since hundreds of hashes at
  // cost 12 would add minutes to the suite for no extra assurance.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),

  /** Account used by `POST /api/auth/demo` so reviewers can skip signing up. */
  DEMO_EMAIL: z.string().default('demo@intellmeet.app'),

  // --- Cloudinary (optional) ------------------------------------------------
  // The app runs fully without these; only the upload-signature endpoint is
  // disabled, and it reports SERVICE_UNAVAILABLE rather than failing obscurely.
  CLOUDINARY_CLOUD_NAME: optionalEnvString,
  CLOUDINARY_API_KEY: optionalEnvString,
  CLOUDINARY_API_SECRET: optionalEnvString,

  /** Base URL of the web client, used to build shareable invite links. */
  CLIENT_URL: z.string().default('http://localhost:5173'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

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
