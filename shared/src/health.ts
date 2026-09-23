import { z } from 'zod';

/** Liveness of one external dependency the API talks to. */
export const dependencyHealthSchema = z.object({
  /** `disabled` means intentionally not configured, not broken. */
  status: z.enum(['up', 'down', 'disabled']),
  /** Round-trip time of the probe command, when one ran. */
  latencyMs: z.number().nonnegative().optional(),
  /** Short reason when `status` is `down`. Never contains credentials. */
  error: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

/**
 * Shape of `GET /api/health` and `GET /api/health/ready`.
 *
 * The server builds its response from this schema and the client parses the
 * response with it, so a change to the contract breaks the build on both
 * sides instead of failing silently at runtime.
 */
export const healthResponseSchema = z.object({
  /** `ok` = every dependency is up; `degraded` = at least one is not. */
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  /** Process uptime in seconds, rounded. */
  uptimeSec: z.number().nonnegative(),
  /** ISO-8601 timestamp of the moment the response was generated. */
  timestamp: z.string(),
  dependencies: z.object({
    mongo: dependencyHealthSchema,
    redis: dependencyHealthSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
