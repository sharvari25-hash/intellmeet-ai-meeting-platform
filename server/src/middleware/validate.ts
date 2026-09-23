import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import type { FieldIssue } from '@intellmeet/shared';
import { AppError } from '../lib/errors.js';
import { replaceQuery } from './sanitize.js';

/** The request parts a route may declare a schema for. */
export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates a request against zod schemas before the handler runs.
 *
 * Two things make this worth a middleware rather than a call inside each
 * handler:
 *
 * 1. **The parsed value is written back.** zod coerces and applies defaults, so
 *    after this runs `req.query.page` is a real `number`, not the string the
 *    query parser produced. Handlers get typed, normalised input.
 * 2. **All parts are checked before failing.** A bad body *and* a bad query
 *    produce one response listing both, instead of making the caller fix one
 *    problem at a time.
 *
 * Schemas come from `@intellmeet/shared`, so the client validates the same
 * rules with the same code before ever sending the request.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: FieldIssue[] = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) req.body = result.data;
      else issues.push(...toFieldIssues('body', result.error.issues));
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) req.params = result.data as typeof req.params;
      else issues.push(...toFieldIssues('params', result.error.issues));
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      // `req.query` is getter-only in Express 5; see sanitize.ts.
      if (result.success) replaceQuery(req, result.data);
      else issues.push(...toFieldIssues('query', result.error.issues));
    }

    if (issues.length > 0) {
      next(AppError.validation(issues));
      return;
    }

    next();
  };
}

/** Flattens zod issues into the `{ path, message }` pairs the API contract uses. */
function toFieldIssues(
  part: string,
  issues: readonly { path: PropertyKey[]; message: string }[],
): FieldIssue[] {
  return issues.map((issue) => ({
    path: [part, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));
}
