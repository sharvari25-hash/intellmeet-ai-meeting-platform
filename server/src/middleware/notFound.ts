import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';

/**
 * Catch-all for unmatched routes.
 *
 * Mounted after every router so an unknown path produces the same
 * `{ error: { code, message } }` body as any other failure, rather than
 * Express's default HTML error page. Clients then need exactly one parser for
 * every non-2xx response.
 */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}
