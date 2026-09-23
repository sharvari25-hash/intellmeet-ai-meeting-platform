import type { RequestHandler } from 'express';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import { getHistory } from '../chat/chat.service.js';
import * as meetingService from './meeting.service.js';

export const create: RequestHandler = async (req, res) => {
  const meeting = await meetingService.createMeeting(req.body, currentUser(req).id);
  res.status(201).json({ meeting });
};

export const list: RequestHandler = async (req, res) => {
  res.json(await meetingService.listMeetings(req.query as never, currentUser(req).id));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json({ meeting: await meetingService.getMeeting(param(req, 'id'), currentUser(req).id) });
};

export const getByCode: RequestHandler = async (req, res) => {
  const meeting = await meetingService.getMeetingByCode(
    param(req, 'roomCode'),
    currentUser(req).id,
  );
  res.json({ meeting });
};

export const update: RequestHandler = async (req, res) => {
  const meeting = await meetingService.updateMeeting(
    param(req, 'id'),
    currentUser(req).id,
    req.body,
  );
  res.json({ meeting });
};

export const start: RequestHandler = async (req, res) => {
  res.json({ meeting: await meetingService.startMeeting(param(req, 'id'), currentUser(req).id) });
};

export const end: RequestHandler = async (req, res) => {
  res.json({ meeting: await meetingService.endMeeting(param(req, 'id'), currentUser(req).id) });
};

export const remove: RequestHandler = async (req, res) => {
  await meetingService.deleteMeeting(param(req, 'id'), currentUser(req).id);
  res.status(204).send();
};

export const messages: RequestHandler = async (req, res) => {
  // Membership is enforced before any history is read.
  await meetingService.getMeetingForMember(param(req, 'id'), currentUser(req).id);
  res.json(await getHistory(param(req, 'id'), req.query as never));
};
