import { Router } from 'express';
import { idParamsSchema, listNotificationsQuerySchema } from '@intellmeet/shared';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './notification.controller.js';

export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

notificationRouter.get('/', validate({ query: listNotificationsQuerySchema }), controller.list);

// Declared before '/:id/read' is irrelevant here, but keeping the literal
// route first is the habit that avoids param routes swallowing it.
notificationRouter.patch('/read-all', controller.markAllRead);
notificationRouter.patch('/:id/read', validate({ params: idParamsSchema }), controller.markRead);
