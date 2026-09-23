import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Accepts only opaque, log-safe ids so an upstream header cannot forge log lines. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Assigns every request a correlation id and echoes it back on the response.
 *
 * Runs first in the pipeline so that every later middleware - including the
 * logger and the error handler - can stamp the same id. A user reporting a
 * failure can quote the `X-Request-Id` from the error body and it will match
 * exactly one request in the logs.
 *
 * An inbound id is reused (so a trace survives across services) but only after
 * validation, otherwise a caller could inject newlines into the log stream.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(REQUEST_ID_HEADER);
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
}
