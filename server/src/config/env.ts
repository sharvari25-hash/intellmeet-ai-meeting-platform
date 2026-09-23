import 'dotenv/config';
import { z } from 'zod';

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

  // Comma-separated allowlist -> string[]. Used by the CORS middleware (Phase 1).
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

  // Required from Phase 1 onwards; optional now so Phase 0 runs with no
  // infrastructure at all (no Docker, no Atlas account needed yet).
  // Kept as plain non-empty strings rather than URL-validated: the real
  // values use non-HTTP schemes (mongodb+srv://, rediss://) that URL
  // validators handle inconsistently.
  MONGODB_URI: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
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
