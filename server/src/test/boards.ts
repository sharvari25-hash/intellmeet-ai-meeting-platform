import type { Express } from 'express';
import request from 'supertest';
import type { BoardDetail, CreateTaskInput, Task } from '@intellmeet/shared';
import { bearer, createInvite, createTeam, registerUser, type TestUser } from './fixtures.js';

/**
 * Board and task helpers for the Phase 8 suites, through the real HTTP
 * surface like the rest of the fixtures.
 */

export interface BoardTeam {
  /** Created the team, so its admin. */
  admin: TestUser;
  /** Joined with an invite: a plain member. */
  member: TestUser;
  /** In no team at all. */
  outsider: TestUser;
  teamId: string;
}

export async function teamWithMember(app: Express): Promise<BoardTeam> {
  const admin = await registerUser(app, { name: 'Ada Lovelace' });
  const member = await registerUser(app, { name: 'Grace Hopper' });
  const outsider = await registerUser(app, { name: 'Alan Turing' });
  const teamId = await createTeam(app, admin);
  const code = await createInvite(app, admin, teamId);
  await request(app)
    .post('/api/teams/join')
    .set('Authorization', bearer(member))
    .send({ code })
    .expect(200);
  return { admin, member, outsider, teamId };
}

/** The team's default board with its tasks, created on first use. */
export async function defaultBoard(
  app: Express,
  user: TestUser,
  teamId: string,
): Promise<BoardDetail> {
  const list = await request(app)
    .get(`/api/boards?teamId=${teamId}`)
    .set('Authorization', bearer(user))
    .expect(200);
  const boardId = (list.body.boards as { id: string; isDefault: boolean }[]).find(
    (board) => board.isDefault,
  )?.id;
  if (!boardId) throw new Error('No default board');
  return loadBoard(app, user, boardId);
}

export async function loadBoard(
  app: Express,
  user: TestUser,
  boardId: string,
): Promise<BoardDetail> {
  const response = await request(app)
    .get(`/api/boards/${boardId}`)
    .set('Authorization', bearer(user))
    .expect(200);
  return response.body as BoardDetail;
}

export async function addTask(
  app: Express,
  user: TestUser,
  boardId: string,
  input: Partial<CreateTaskInput> = {},
): Promise<Task> {
  const response = await request(app)
    .post(`/api/boards/${boardId}/tasks`)
    .set('Authorization', bearer(user))
    .send({ title: 'Write the release notes', ...input })
    .expect(201);
  return response.body.task as Task;
}

/** Titles of a column's tasks, top to bottom. */
export function columnTitles(detail: BoardDetail, columnId: string): string[] {
  return detail.tasks
    .filter((task) => task.columnId === columnId)
    .sort((a, b) => a.order - b.order)
    .map((task) => task.title);
}
