import type { RequestHandler } from 'express';
import { param } from '../../lib/http.js';
import { currentUser } from '../../middleware/requireAuth.js';
import {
  announceComment,
  announceTaskCreated,
  announceTaskDeleted,
  announceTaskMoved,
  announceTaskUpdated,
  notifyAssigned,
  notifyCommentMentions,
} from './task.events.js';
import { createTasksFromActionItems } from './task.fromMeeting.js';
import * as taskService from './task.service.js';

export const mine: RequestHandler = async (req, res) => {
  res.json({ tasks: await taskService.listMyTasks(currentUser(req).id) });
};

export const getOne: RequestHandler = async (req, res) => {
  res.json({ task: await taskService.getTask(param(req, 'id'), currentUser(req).id) });
};

export const update: RequestHandler = async (req, res) => {
  const userId = currentUser(req).id;
  const { task, newAssigneeId } = await taskService.updateTask(param(req, 'id'), userId, req.body);

  announceTaskUpdated(task);
  if (newAssigneeId) await notifyAssigned([task], userId);
  res.json({ task });
};

export const move: RequestHandler = async (req, res) => {
  const moved = await taskService.moveTask(param(req, 'id'), currentUser(req).id, req.body);
  announceTaskMoved(moved);
  res.json(moved);
};

export const remove: RequestHandler = async (req, res) => {
  const { boardId, taskId } = await taskService.deleteTask(param(req, 'id'), currentUser(req).id);
  announceTaskDeleted(boardId, taskId);
  res.status(204).send();
};

export const comments: RequestHandler = async (req, res) => {
  res.json({ comments: await taskService.listComments(param(req, 'id'), currentUser(req).id) });
};

export const addComment: RequestHandler = async (req, res) => {
  const userId = currentUser(req).id;
  const result = await taskService.addComment(param(req, 'id'), userId, req.body.text);

  announceComment({
    boardId: result.boardId,
    taskId: result.task.id,
    comment: result.comment,
    commentCount: result.commentCount,
  });
  await notifyCommentMentions({
    text: result.comment.text,
    authorId: userId,
    task: result.task,
    boardId: result.boardId,
    teamId: result.teamId,
  });
  res.status(201).json({ comment: result.comment, commentCount: result.commentCount });
};

/** `POST /api/meetings/:id/tasks`: action items into tasks, one or many. */
export const fromMeeting: RequestHandler = async (req, res) => {
  const userId = currentUser(req).id;
  const result = await createTasksFromActionItems(param(req, 'id'), userId, req.body);

  for (const task of result.tasks) announceTaskCreated(task);
  await notifyAssigned(result.tasks, userId);
  res.status(201).json(result);
};
