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
