import { Router } from 'express';
import {
  columnParamsSchema,
  createBoardSchema,
  createColumnSchema,
  createCommentSchema,
  createTaskSchema,
  idParamsSchema,
  listBoardsQuerySchema,
  moveTaskSchema,
  renameBoardSchema,
  reorderColumnsSchema,
  updateColumnSchema,
  updateTaskSchema,
} from '@intellmeet/shared';
import { boardWriteLimiter, writeLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validate } from '../../middleware/validate.js';
import * as boards from './board.controller.js';
import * as tasks from './task.controller.js';

/**
 * Boards (`/api/boards`) and tasks (`/api/tasks`).
 *
 * Every route needs a session, and every one checks team membership in the
 * service, so a board id is never a capability on its own. Card edits share a
 * per-account limiter sized for dragging things around; creating whole boards
 * shares the stricter general write limiter.
 */
export const boardRouter: Router = Router();
boardRouter.use(requireAuth);

boardRouter.get('/', validate({ query: listBoardsQuerySchema }), boards.list);
boardRouter.post('/', writeLimiter, validate({ body: createBoardSchema }), boards.create);

boardRouter.get('/:id', validate({ params: idParamsSchema }), boards.getOne);
boardRouter.patch(
  '/:id',
  writeLimiter,
  validate({ params: idParamsSchema, body: renameBoardSchema }),
  boards.rename,
);
boardRouter.delete('/:id', writeLimiter, validate({ params: idParamsSchema }), boards.remove);

boardRouter.post(
  '/:id/columns',
  boardWriteLimiter,
  validate({ params: idParamsSchema, body: createColumnSchema }),
  boards.addColumn,
);
// The whole order at once (a board has a handful of columns).
boardRouter.put(
  '/:id/columns',
  boardWriteLimiter,
  validate({ params: idParamsSchema, body: reorderColumnsSchema }),
  boards.reorderColumns,
);
boardRouter.patch(
  '/:id/columns/:columnId',
  boardWriteLimiter,
  validate({ params: columnParamsSchema, body: updateColumnSchema }),
  boards.updateColumn,
);
boardRouter.delete(
  '/:id/columns/:columnId',
  boardWriteLimiter,
  validate({ params: columnParamsSchema }),
  boards.deleteColumn,
);

boardRouter.post(
  '/:id/tasks',
  boardWriteLimiter,
  validate({ params: idParamsSchema, body: createTaskSchema }),
  boards.createTask,
);

export const taskRouter: Router = Router();
taskRouter.use(requireAuth);

// Declared before '/:id' so the literal segment is not read as an id.
taskRouter.get('/mine', tasks.mine);

taskRouter.get('/:id', validate({ params: idParamsSchema }), tasks.getOne);
taskRouter.patch(
  '/:id',
  boardWriteLimiter,
  validate({ params: idParamsSchema, body: updateTaskSchema }),
  tasks.update,
);
taskRouter.post(
  '/:id/move',
  boardWriteLimiter,
  validate({ params: idParamsSchema, body: moveTaskSchema }),
  tasks.move,
);
taskRouter.delete('/:id', boardWriteLimiter, validate({ params: idParamsSchema }), tasks.remove);

taskRouter.get('/:id/comments', validate({ params: idParamsSchema }), tasks.comments);
taskRouter.post(
  '/:id/comments',
  boardWriteLimiter,
  validate({ params: idParamsSchema, body: createCommentSchema }),
  tasks.addComment,
);
