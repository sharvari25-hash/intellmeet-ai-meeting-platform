import type { RequestHandler } from 'express';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import * as boardService from './board.service.js';
import { announceBoardRefresh, announceTaskCreated, notifyAssigned } from './task.events.js';
import * as taskService from './task.service.js';

export const list: RequestHandler = async (req, res) => {
  const { teamId } = req.query as { teamId: string };
  res.json({ boards: await boardService.listBoards(teamId, currentUser(req).id) });
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json({ board: await boardService.createBoard(req.body, currentUser(req).id) });
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await taskService.getBoardDetail(param(req, 'id'), currentUser(req).id));
};

/**
 * Changes to the board itself are rare and reshape the whole page, so viewers
 * are told to reload rather than sent a patch to apply.
 */
function refreshed(board: { id: string }) {
  announceBoardRefresh([board.id]);
  return { board };
}

export const rename: RequestHandler = async (req, res) => {
  const board = await boardService.renameBoard(
    param(req, 'id'),
    currentUser(req).id,
    req.body.name,
  );
  res.json(refreshed(board));
};

export const remove: RequestHandler = async (req, res) => {
  await boardService.deleteBoard(param(req, 'id'), currentUser(req).id);
  announceBoardRefresh([param(req, 'id')]);
  res.status(204).send();
};

export const addColumn: RequestHandler = async (req, res) => {
  const board = await boardService.addColumn(param(req, 'id'), currentUser(req).id, req.body.title);
  res.status(201).json(refreshed(board));
};

export const updateColumn: RequestHandler = async (req, res) => {
  const board = await boardService.updateColumn(
    param(req, 'id'),
    param(req, 'columnId'),
    currentUser(req).id,
    req.body,
  );
  res.json(refreshed(board));
};

export const deleteColumn: RequestHandler = async (req, res) => {
  const board = await boardService.deleteColumn(
    param(req, 'id'),
    param(req, 'columnId'),
    currentUser(req).id,
  );
  res.json(refreshed(board));
};

export const reorderColumns: RequestHandler = async (req, res) => {
  const board = await boardService.reorderColumns(
    param(req, 'id'),
    currentUser(req).id,
    req.body.columnIds,
  );
  res.json(refreshed(board));
};

export const createTask: RequestHandler = async (req, res) => {
  const userId = currentUser(req).id;
  const task = await taskService.createTask(param(req, 'id'), userId, req.body);

  announceTaskCreated(task);
  await notifyAssigned([task], userId);
  res.status(201).json({ task });
};
