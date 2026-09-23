import type { RequestHandler } from 'express';
import { currentUser } from '../../middleware/requireAuth.js';
import * as userService from './user.service.js';

export const getMe: RequestHandler = async (req, res) => {
  const user = await userService.getUserById(currentUser(req).id);
  res.json({ user: userService.toPublicUser(user) });
};

export const patchMe: RequestHandler = async (req, res) => {
  res.json({ user: await userService.updateMe(currentUser(req).id, req.body) });
};
