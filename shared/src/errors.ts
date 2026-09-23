import { z } from 'zod';

/**
 * The complete set of error codes the API can return.
 *
 * Codes are stable, machine-readable and independent of HTTP status: the
 * client switches on `code` (e.g. to redirect on `UNAUTHORIZED`) instead of
 * pattern-matching on human-readable messages that may be reworded.
 */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** One field-level problem, e.g. `{ path: 'body.email', message: 'Invalid email' }`. */
export const fieldIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type FieldIssue = z.infer<typeof fieldIssueSchema>;

/**
 * Every non-2xx response from the API has exactly this body. One shape means
 * the client needs one error-handling path rather than one per endpoint.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** Present on VALIDATION_ERROR: which fields failed and why. */
    details: z.array(fieldIssueSchema).optional(),
    /** Correlates the response with the server logs for this request. */
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
