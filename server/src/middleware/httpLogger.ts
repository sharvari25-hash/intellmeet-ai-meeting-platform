import { pinoHttp } from 'pino-http';
import type { Request } from 'express';
import { logger } from '../lib/logger.js';

/**
 * One structured log line per request, correlated by `req.id`.
 *
 * Sits second in the pipeline - after `requestId` so the id exists, but before
 * everything else so that requests rejected by helmet or CORS still appear in
 * the logs.
 */
export const httpLogger = pinoHttp({
  logger,

  // Reuse our correlation id rather than pino's own counter.
  genReqId: (req) => (req as Request).id,

  // 5xx is our bug, 4xx is the caller's mistake, everything else is routine.
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },

  autoLogging: {
    // The free-tier keep-alive pings /api/health every 10 minutes and Render
    // and Kubernetes probe it constantly; logging all of that would bury the
    // real traffic.
    ignore: (req) => req.url?.startsWith('/api/health') ?? false,
  },

  // Keep lines small: the full header/body dumps pino-http emits by default
  // are noise, and are exactly where secrets would leak.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
