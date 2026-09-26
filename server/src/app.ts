import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { httpLogger } from './middleware/httpLogger.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { mongoSanitize, preventParameterPollution } from './middleware/sanitize.js';
import { analyticsRouter } from './modules/analytics/analytics.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { meetingRouter } from './modules/meetings/meeting.routes.js';
import { notificationRouter } from './modules/notifications/notification.routes.js';
import { rtcRouter } from './modules/rtc/rtc.routes.js';
import { boardRouter, taskRouter } from './modules/tasks/task.routes.js';
import { teamRouter } from './modules/teams/team.routes.js';
import { uploadRouter } from './modules/uploads/upload.routes.js';
import { userRouter } from './modules/users/user.routes.js';

/**
 * Builds the Express application.
 *
 * Kept separate from `server.ts` (which owns the listening socket and the
 * database connections) so tests can drive the app through Supertest without
 * binding a port.
 *
 * The middleware order below is deliberate; each step depends on the previous:
 *
 *  1. requestId   - every later stage stamps the same correlation id
 *  2. httpLogger  - so even requests rejected below are logged
 *  3. helmet      - security headers on every response, including errors
 *  4. cors        - reject disallowed origins before doing any real work
 *  5. json(1mb)   - bound the body before parsing it (DoS guard)
 *  6. cookies     - needed by auth from Phase 2
 *  7. sanitize    - strip Mongo operators before any handler sees the input
 *  8. hpp         - collapse duplicated query params to a predictable scalar
 *  9. routes
 * 10. notFound    - unmatched paths become a normal AppError
 * 11. errorHandler- the single place an error becomes an HTTP response
 */
export function createApp(): Express {
  const app = express();

  // One proxy hop is trusted: behind nginx (Docker Compose, the Kubernetes
  // Ingress) `req.ip` is then the visitor, from the X-Forwarded-For nginx
  // sets. On Render there are more hops than that, and `req.ip` is one of
  // Render's own proxies (measured), so rate limits and sessions read the
  // address through lib/clientIp.ts, which handles both.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(httpLogger);

  app.use(
    helmet({
      // The API is consumed by a browser on a different origin (Vercel ->
      // Render), so the default `same-origin` policy would block reads.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(corsMiddleware);

  // 1 MB is generous for JSON: recordings upload straight to Cloudinary from
  // the browser (Phase 6) and never pass through this process.
  app.use(express.json({ limit: '1mb' }));

  app.use(cookieParser());

  app.use(mongoSanitize);
  app.use(preventParameterPollution());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/teams', teamRouter);
  app.use('/api/meetings', meetingRouter);
  app.use('/api/boards', boardRouter);
  app.use('/api/tasks', taskRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/rtc', rtcRouter);
  app.use('/api/uploads', uploadRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
