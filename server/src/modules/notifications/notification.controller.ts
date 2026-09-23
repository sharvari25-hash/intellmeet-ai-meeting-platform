import type { RequestHandler } from 'express';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as notificationService from './notification.service.js';

export const list: RequestHandler = async (req, res) => {
  const { unreadOnly, limit } = req.query as unknown as { unreadOnly: boolean; limit: number };
  res.json(await notificationService.listNotifications(currentUser(req).id, { unreadOnly, limit }));
};

export const markRead: RequestHandler = async (req, res) => {
  const notification = await notificationService.markRead(currentUser(req).id, param(req, 'id'));
  res.json({ notification });
};

export const markAllRead: RequestHandler = async (req, res) => {
  res.json({ updated: await notificationService.markAllRead(currentUser(req).id) });
};
