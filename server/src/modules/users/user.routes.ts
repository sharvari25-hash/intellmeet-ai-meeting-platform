import { Router } from 'express';
import { updateMeSchema } from '@intellmeet/shared';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './user.controller.js';

export const userRouter: Router = Router();

// Every route here is about the caller's own account, so auth applies to all
// of them; mounting it once on the router is less error-prone than repeating
// it per route and forgetting one.
userRouter.use(requireAuth);

userRouter.get('/me', controller.getMe);
userRouter.patch('/me', validate({ body: updateMeSchema }), controller.patchMe);
