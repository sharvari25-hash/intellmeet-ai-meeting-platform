import { Router } from 'express';
import { analyticsExportQuerySchema, analyticsQuerySchema } from '@intellmeet/shared';
import { analyticsLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './analytics.controller.js';

/**
 * Team analytics (`/api/analytics`), all `?teamId=&from=&to=&tz=`.
 *
 * Signed in, rate limited per account (a changed range is a cache miss, so
 * the limit is what bounds how many aggregations one person can start), and
 * every handler checks team membership before reading anything.
 */
export const analyticsRouter: Router = Router();
analyticsRouter.use(requireAuth, analyticsLimiter);

analyticsRouter.get('/overview', validate({ query: analyticsQuerySchema }), controller.overview);
analyticsRouter.get('/weekly', validate({ query: analyticsQuerySchema }), controller.weekly);
analyticsRouter.get('/members', validate({ query: analyticsQuerySchema }), controller.members);
analyticsRouter.get(
  '/export',
  validate({ query: analyticsExportQuerySchema }),
  controller.exportCsv,
);
