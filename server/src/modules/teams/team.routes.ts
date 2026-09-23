import { Router } from 'express';
import {
  createTeamSchema,
  idParamsSchema,
  joinTeamSchema,
  teamMemberParamsSchema,
  updateMemberRoleSchema,
} from '@intellmeet/shared';
import { writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './team.controller.js';

export const teamRouter: Router = Router();

// There is no such thing as an anonymous team operation.
teamRouter.use(requireAuth);

teamRouter.post('/', writeLimiter, validate({ body: createTeamSchema }), controller.create);
teamRouter.get('/', controller.listMine);

// Declared before '/:id' so the literal path is not swallowed by the param route.
teamRouter.post('/join', writeLimiter, validate({ body: joinTeamSchema }), controller.join);

teamRouter.get('/:id', validate({ params: idParamsSchema }), controller.getOne);

teamRouter.post(
  '/:id/invites',
  writeLimiter,
  validate({ params: idParamsSchema }),
  controller.createInvite,
);

teamRouter.delete(
  '/:id/members/:userId',
  validate({ params: teamMemberParamsSchema }),
  controller.removeMember,
);

teamRouter.patch(
  '/:id/members/:userId',
  validate({ params: teamMemberParamsSchema, body: updateMemberRoleSchema }),
  controller.updateMemberRole,
);
