import { Router } from 'express';
import { uploadSignatureQuerySchema } from '@intellmeet/shared';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './upload.controller.js';

export const uploadRouter: Router = Router();

/**
 * GET /api/uploads/signature?kind=avatar|recording
 *
 * Authenticated, because a signature is a time-limited write credential for
 * our Cloudinary account - an anonymous endpoint here would be an open file
 * host that someone else pays for.
 */
uploadRouter.get(
  '/signature',
  requireAuth,
  validate({ query: uploadSignatureQuerySchema }),
  controller.getSignature,
);
