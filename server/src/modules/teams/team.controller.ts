import type { RequestHandler } from 'express';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as teamService from './team.service.js';

export const create: RequestHandler = async (req, res) => {
  const team = await teamService.createTeam(req.body.name, currentUser(req).id);
  res.status(201).json({ team });
};

export const listMine: RequestHandler = async (req, res) => {
  res.json({ teams: await teamService.listMyTeams(currentUser(req).id) });
};

export const getOne: RequestHandler = async (req, res) => {
  res.json({ team: await teamService.getTeam(param(req, 'id'), currentUser(req).id) });
};

export const createInvite: RequestHandler = async (req, res) => {
  const invite = await teamService.createInvite(param(req, 'id'), currentUser(req).id);
  res.status(201).json({ invite });
};

export const join: RequestHandler = async (req, res) => {
  res.json({ team: await teamService.joinTeam(req.body.code, currentUser(req).id) });
};

export const removeMember: RequestHandler = async (req, res) => {
  const team = await teamService.removeMember(
    param(req, 'id'),
    currentUser(req).id,
    param(req, 'userId'),
  );
  res.json({ team });
};

export const updateMemberRole: RequestHandler = async (req, res) => {
  const team = await teamService.updateMemberRole(
    param(req, 'id'),
    currentUser(req).id,
    param(req, 'userId'),
    req.body.role,
  );
  res.json({ team });
};
