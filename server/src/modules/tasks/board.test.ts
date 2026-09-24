import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEFAULT_COLUMNS, MAX_COLUMNS, boardDetailSchema, type Board } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { addTask, defaultBoard, teamWithMember } from '../../test/boards.js';
import { bearer } from '../../test/fixtures.js';
import { Board as BoardModel } from './board.model.js';
import { ensureDefaultBoard } from './board.service.js';

const app = createApp();

describe('a team’s boards', () => {
  it('start with one default board, To Do / In Progress / Review / Done', async () => {
    const { member, teamId } = await teamWithMember(app);

    const detail = await defaultBoard(app, member, teamId);

    expect(boardDetailSchema.safeParse(detail).success).toBe(true);
    expect(detail.board.isDefault).toBe(true);
    expect(detail.board.columns.map((column) => column.title)).toEqual(
      DEFAULT_COLUMNS.map((column) => column.title),
    );
    // Only the last one means finished.
    expect(detail.board.columns.map((column) => column.isDone)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(detail.board.myRole).toBe('member');
    expect(detail.tasks).toEqual([]);
  });

  it('get exactly one default board, however many first visits race', async () => {
    const { teamId } = await teamWithMember(app);
    // The partial unique index is the guarantee under test.
    await BoardModel.init();

    await Promise.all(Array.from({ length: 5 }, () => ensureDefaultBoard(teamId)));

    expect(await BoardModel.countDocuments({ teamId, isDefault: true })).toBe(1);
  });

  it('are hidden from anyone outside the team, as not found', async () => {
    const { admin, outsider, teamId } = await teamWithMember(app);
    const detail = await defaultBoard(app, admin, teamId);

    await request(app)
      .get(`/api/boards?teamId=${teamId}`)
      .set('Authorization', bearer(outsider))
      .expect(404);
    await request(app)
      .get(`/api/boards/${detail.board.id}`)
      .set('Authorization', bearer(outsider))
      .expect(404);
  });

  it('can be added and renamed by an admin, not by a member', async () => {
    const { admin, member, teamId } = await teamWithMember(app);

    await request(app)
      .post('/api/boards')
      .set('Authorization', bearer(member))
      .send({ teamId, name: 'Hiring' })
      .expect(403);

    const created = await request(app)
      .post('/api/boards')
      .set('Authorization', bearer(admin))
      .send({ teamId, name: 'Hiring' })
      .expect(201);
    const board = created.body.board as Board;
    expect(board.isDefault).toBe(false);

    const list = await request(app)
      .get(`/api/boards?teamId=${teamId}`)
      .set('Authorization', bearer(member))
      .expect(200);
    // The default first.
    expect(list.body.boards.map((b: Board) => b.name)).toEqual(['Team board', 'Hiring']);

    await request(app)
      .patch(`/api/boards/${board.id}`)
      .set('Authorization', bearer(member))
      .send({ name: 'Recruiting' })
      .expect(403);
    const renamed = await request(app)
      .patch(`/api/boards/${board.id}`)
      .set('Authorization', bearer(admin))
      .send({ name: 'Recruiting' })
      .expect(200);
    expect(renamed.body.board.name).toBe('Recruiting');
  });

  it('can be deleted with their tasks, except the default one', async () => {
    const { admin, teamId } = await teamWithMember(app);
    const main = await defaultBoard(app, admin, teamId);
    const extra = (
      await request(app)
        .post('/api/boards')
        .set('Authorization', bearer(admin))
        .send({ teamId, name: 'Scratch' })
        .expect(201)
    ).body.board as Board;
    await addTask(app, admin, extra.id);

    await request(app)
      .delete(`/api/boards/${main.board.id}`)
      .set('Authorization', bearer(admin))
      .expect(409);
    await request(app)
      .delete(`/api/boards/${extra.id}`)
      .set('Authorization', bearer(admin))
      .expect(204);
    await request(app)
      .get(`/api/boards/${extra.id}`)
      .set('Authorization', bearer(admin))
      .expect(404);
  });
});

describe('columns', () => {
  it('are added, renamed and marked done by an admin only', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);

    await request(app)
      .post(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(member))
      .send({ title: 'Blocked' })
      .expect(403);

    const added = await request(app)
      .post(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(admin))
      .send({ title: 'Blocked' })
      .expect(201);
    const blocked = (added.body.board as Board).columns.at(-1);
    expect(blocked).toMatchObject({ title: 'Blocked', isDone: false });

    const renamed = await request(app)
      .patch(`/api/boards/${board.id}/columns/${blocked?.id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'Won’t do', isDone: true })
      .expect(200);
    expect((renamed.body.board as Board).columns.at(-1)).toMatchObject({
      id: blocked?.id,
      title: 'Won’t do',
      isDone: true,
    });

    await request(app)
      .patch(`/api/boards/${board.id}/columns/${blocked?.id}`)
      .set('Authorization', bearer(member))
      .send({ title: 'x' })
      .expect(403);
  });

  it('are reordered as a whole list, which must be exactly the current columns', async () => {
    const { admin, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const ids = board.columns.map((column) => column.id);
    const reversed = [...ids].reverse();

    const response = await request(app)
      .put(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(admin))
      .send({ columnIds: reversed })
      .expect(200);
    expect((response.body.board as Board).columns.map((column) => column.id)).toEqual(reversed);
    // Identity survives the move: the done column is still the done column.
    expect((response.body.board as Board).columns[0]).toMatchObject({
      title: 'Done',
      isDone: true,
    });

    // A list missing a column (a client that has not seen one being added)
    // would silently drop it.
    await request(app)
      .put(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(admin))
      .send({ columnIds: ids.slice(1) })
      .expect(409);
    await request(app)
      .put(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(admin))
      .send({ columnIds: [ids[0], ids[0], ids[1], ids[2]] })
      .expect(409);
  });

  it('are removed only when empty', async () => {
    const { admin, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const [todo, doing] = board.columns;
    await addTask(app, admin, board.id, { columnId: todo?.id });

    const refused = await request(app)
      .delete(`/api/boards/${board.id}/columns/${todo?.id}`)
      .set('Authorization', bearer(admin))
      .expect(409);
    expect(refused.body.error.message).toMatch(/move the tasks/i);

    const removed = await request(app)
      .delete(`/api/boards/${board.id}/columns/${doing?.id}`)
      .set('Authorization', bearer(admin))
      .expect(200);
    expect((removed.body.board as Board).columns.map((column) => column.title)).toEqual([
      'To Do',
      'Review',
      'Done',
    ]);
  });

  it('never go below one', async () => {
    const { admin, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const [last, ...rest] = board.columns;

    for (const column of rest) {
      await request(app)
        .delete(`/api/boards/${board.id}/columns/${column.id}`)
        .set('Authorization', bearer(admin))
        .expect(200);
    }
    const refused = await request(app)
      .delete(`/api/boards/${board.id}/columns/${last?.id}`)
      .set('Authorization', bearer(admin))
      .expect(409);
    expect(refused.body.error.message).toMatch(/at least one column/i);
  });

  it('are capped per board', async () => {
    const { admin, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);

    for (let i = board.columns.length; i < MAX_COLUMNS; i += 1) {
      await request(app)
        .post(`/api/boards/${board.id}/columns`)
        .set('Authorization', bearer(admin))
        .send({ title: `Column ${i}` })
        .expect(201);
    }
    await request(app)
      .post(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(admin))
      .send({ title: 'One too many' })
      .expect(409);
  });
});
