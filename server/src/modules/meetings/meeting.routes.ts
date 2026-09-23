import { Router } from 'express';
import {
  createMeetingSchema,
  idParamsSchema,
  listMeetingsQuerySchema,
  messageHistoryQuerySchema,
  roomCodeParamsSchema,
  updateMeetingSchema,
} from '@intellmeet/shared';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './meeting.controller.js';

export const meetingRouter: Router = Router();

// No anonymous meeting operations: even joining by code requires an account,
// because a room code is a convenience for people who already have access,
// not a capability that grants it.
meetingRouter.use(requireAuth);

meetingRouter.post('/', writeLimiter, validate({ body: createMeetingSchema }), controller.create);
meetingRouter.get('/', validate({ query: listMeetingsQuerySchema }), controller.list);

// Declared before '/:id' so the literal segment is not swallowed by the param.
meetingRouter.get(
  '/code/:roomCode',
  validate({ params: roomCodeParamsSchema }),
  controller.getByCode,
);

meetingRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);

meetingRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateMeetingSchema }),
  controller.update,
);

meetingRouter.delete('/:id', validate({ params: idParamsSchema }), controller.remove);

meetingRouter.post('/:id/start', validate({ params: idParamsSchema }), controller.start);
meetingRouter.post('/:id/end', validate({ params: idParamsSchema }), controller.end);

meetingRouter.get(
  '/:id/messages',
  validate({ params: idParamsSchema, query: messageHistoryQuerySchema }),
  controller.messages,
);
