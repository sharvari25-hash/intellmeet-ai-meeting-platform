import type { RequestHandler } from 'express';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as aiService from './ai.service.js';

export const intelligence: RequestHandler = async (req, res) => {
  res.json(await aiService.getMeetingIntelligence(param(req, 'id'), currentUser(req).id));
};

/**
 * The host corrects the AI output. Answers with the whole intelligence
 * payload, so the page can replace its cached copy without a second request.
 */
export const updateInsight: RequestHandler = async (req, res) => {
  res.json(await aiService.updateInsight(param(req, 'id'), currentUser(req).id, req.body));
};
