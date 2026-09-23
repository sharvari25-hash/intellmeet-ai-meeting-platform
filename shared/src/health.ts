import { z } from 'zod';

/**
 * Shape of `GET /api/health`.
 *
 * The server builds its response from this schema and the client parses the
 * response with it, so a change to the contract breaks the build on both
 * sides instead of failing silently at runtime.
 */
export const healthResponseSchema = z.object({
  /** Overall service state. Extended in Phase 1 with db/redis sub-checks. */
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  /** Process uptime in seconds, rounded. */
  uptimeSec: z.number().nonnegative(),
  /** ISO-8601 timestamp of the moment the response was generated. */
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
