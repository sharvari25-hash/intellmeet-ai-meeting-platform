import type { Request } from 'express';
import { AppError } from './errors.js';

/**
 * Reads a route parameter that a zod `params` schema has already validated.
 *
 * Express 5 types `req.params` values as `string | string[] | undefined` to
 * cover wildcard segments, so every use site would otherwise need a cast. The
 * cast is centralised here together with the check that makes it honest: if
 * the value is missing, the route was mounted without its `validate({ params })`
 * middleware, and that is a wiring bug worth failing loudly on rather than
 * passing `undefined` into a database query.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name];

  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.internal(
      `Route parameter "${name}" is missing. Is validate({ params }) mounted on this route?`,
    );
  }

  return value;
}
