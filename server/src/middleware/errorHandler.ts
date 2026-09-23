import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiError, FieldIssue } from '@intellmeet/shared';
import { isProduction } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/** Body-parser attaches a `type` discriminator to the errors it throws. */
interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

/** MongoDB signals a unique-index violation with numeric code 11000. */
interface MongoServerError extends Error {
  code?: number;
  keyValue?: Record<string, unknown>;
}

/**
 * Normalises anything thrown anywhere in the app into an `AppError`.
 *
 * Errors arrive from three places - our own code, the libraries in the
 * pipeline (body-parser, mongo driver, zod), and genuine bugs. Translating
 * them here means handlers never need defensive try/catch just to produce a
 * sensible status code.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof ZodError) {
    const details: FieldIssue[] = error.issues.map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message,
    }));
    return AppError.validation(details);
  }

  if (error instanceof Error) {
    const bodyParserError = error as BodyParserError;

    // Body larger than the 1 MB `express.json` limit.
    if (bodyParserError.type === 'entity.too.large') {
      return new AppError('PAYLOAD_TOO_LARGE', 'Request body exceeds the 1MB limit', {
        cause: error,
      });
    }

    // Malformed JSON: the caller's mistake, so 400 rather than 500.
    if (bodyParserError.type === 'entity.parse.failed' || error instanceof SyntaxError) {
      return AppError.badRequest('Request body is not valid JSON', { cause: error });
    }

    // Duplicate key on a unique index (e.g. registering an existing email).
    const mongoError = error as MongoServerError;
    if (mongoError.code === 11000) {
      const field = Object.keys(mongoError.keyValue ?? {})[0];
      return AppError.conflict(
        field ? `A record with that ${field} already exists` : 'Record already exists',
        { cause: error },
      );
    }
  }

  // Keep the original message. It is masked before it reaches the client in
  // production (see `isClientSafe` in the handler below), but preserving it
  // means a development or test failure reports what actually went wrong
  // instead of a uniformly useless "Internal server error".
  return AppError.internal(
    error instanceof Error && error.message ? error.message : 'Internal server error',
    { cause: error },
  );
}

/**
 * The single place an error becomes an HTTP response.
 *
 * Express recognises this as an error handler by its four-parameter signature,
 * so it must keep `_next` even though it is unused.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const appError = toAppError(error);

  const logPayload = {
    err: appError,
    cause: appError.cause,
    reqId: req.id,
    method: req.method,
    url: req.originalUrl,
    status: appError.status,
    code: appError.code,
  };

  // A 4xx is the caller getting it wrong (expected, warn); a 5xx is our bug
  // (unexpected, error + full stack so it reaches Sentry in Phase 13).
  if (appError.status >= 500) logger.error(logPayload, appError.message);
  else logger.warn(logPayload, appError.message);

  // If the response already started streaming, headers cannot change - hand
  // back to Express, which will destroy the socket.
  if (res.headersSent) {
    res.end();
    return;
  }

  const body: ApiError = {
    error: {
      code: appError.code,
      // 5xx messages describe internals (stack frames, connection strings), so
      // they are replaced with a fixed string in production. Development keeps
      // the real message to stay debuggable.
      message: appError.isClientSafe || !isProduction ? appError.message : 'Internal server error',
      ...(appError.details ? { details: appError.details } : {}),
      requestId: req.id,
    },
  };

  res.status(appError.status).json(body);
}
