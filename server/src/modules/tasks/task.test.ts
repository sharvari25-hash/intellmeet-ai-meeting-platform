import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { MAX_TASKS_PER_BOARD, taskMovedSchema, taskSchema, type Task } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import {
  addTask,
  columnTitles,
  defaultBoard,
  loadBoard,
  teamWithMember,
} from '../../test/boards.js';
import { bearer, type TestUser } from '../../test/fixtures.js';
import { Notification } from '../notifications/notification.model.js';
import { Board } from './board.model.js';
import { Task as TaskModel } from './task.model.js';

const app = createApp();

async function move(
  user: TestUser,
  taskId: string,
  body: { columnId: string; afterId?: string | null; beforeId?: string | null },
) {
  return request(app)
    .post(`/api/tasks/${taskId}/move`)
    .set('Authorization', bearer(user))
    .send(body);
}

describe('creating tasks', () => {
  it('puts a new task at the bottom of the first column, with its details', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);

    const first = await addTask(app, member, board.id, { title: 'First' });
    const second = await addTask(app, member, board.id, {
      title: 'Second',
      description: 'With notes',
      assigneeId: admin.id,
      dueDate: '2026-10-02',
      priority: 'high',
    });

    expect(taskSchema.safeParse(second).success).toBe(true);
    expect(second).toMatchObject({
      columnId: board.columns[0]?.id,
      description: 'With notes',
      assigneeId: admin.id,
      assigneeName: 'Ada Lovelace',
      dueDate: '2026-10-02',
      priority: 'high',
      createdBy: member.id,
      createdByName: 'Grace Hopper',
      source: null,
      commentCount: 0,
      version: 1,
    });
    expect(second.order).toBeGreaterThan(first.order);
    expect(first.priority).toBe('medium');
  });

  it('only assigns team members, and only into the board’s own columns', async () => {
    const { member, outsider, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);

    const stranger = await request(app)
      .post(`/api/boards/${board.id}/tasks`)
      .set('Authorization', bearer(member))
      .send({ title: 'x', assigneeId: outsider.id })
      .expect(400);
    expect(stranger.body.error.details[0].path).toBe('body.assigneeId');

    await request(app)
      .post(`/api/boards/${board.id}/tasks`)
      .set('Authorization', bearer(member))
      .send({ title: 'x', columnId: board.id })
      .expect(400);

    await request(app)
      .post(`/api/boards/${board.id}/tasks`)
      .set('Authorization', bearer(outsider))
      .send({ title: 'x' })
      .expect(404);
  });

  it('validates what it is sent', async () => {
    const { member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);

    const response = await request(app)
      .post(`/api/boards/${board.id}/tasks`)
      .set('Authorization', bearer(member))
      .send({ title: '  ', dueDate: '2026-02-30', priority: 'urgent' })
      .expect(400);
    const paths = response.body.error.details.map((issue: { path: string }) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['body.title', 'body.dueDate', 'body.priority']));
  });

  it('refuses to grow a board past its cap', async () => {
    const { member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);
    const columnId = board.columns[0]?.id;
    await TaskModel.insertMany(
      Array.from({ length: MAX_TASKS_PER_BOARD }, (_, index) => ({
        boardId: board.id,
        teamId,
        columnId,
        title: `Task ${index}`,
        order: index,
        createdBy: member.id,
      })),
    );

    await request(app)
      .post(`/api/boards/${board.id}/tasks`)
      .set('Authorization', bearer(member))
      .send({ title: 'One too many' })
      .expect(409);
  });

  it('tells the assignee, but not somebody assigning themselves', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);

    const given = await addTask(app, member, board.id, {
      title: 'Review the PR',
      assigneeId: admin.id,
    });
    await addTask(app, member, board.id, { title: 'My own', assigneeId: member.id });

    const notifications = await Notification.find({ type: 'task_assigned' });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: 'Grace Hopper assigned you a task',
      body: 'Review the PR',
    });
    expect(notifications[0]?.userId.toString()).toBe(admin.id);
    expect(notifications[0]?.payload).toMatchObject({ taskId: given.id, boardId: board.id });
  });
});

describe('editing and deleting tasks', () => {
  it('lets any member edit a task, bumping its version', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);
    const task = await addTask(app, admin, board.id);

    const response = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', bearer(member))
      .send({ title: 'Write the 1.4 release notes', assigneeId: admin.id, dueDate: null })
      .expect(200);

    expect(response.body.task).toMatchObject({
      title: 'Write the 1.4 release notes',
      assigneeName: 'Ada Lovelace',
      dueDate: null,
      version: 2,
    });
    // Reassigned by somebody else: the new owner hears about it.
    expect(await Notification.countDocuments({ type: 'task_assigned', userId: admin.id })).toBe(1);
  });

  it('lets the creator or an admin delete a task, and nobody else', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);
    const mine = await addTask(app, member, board.id, { title: 'Mine' });
    const theirs = await addTask(app, admin, board.id, { title: 'Theirs' });

    const refused = await request(app)
      .delete(`/api/tasks/${theirs.id}`)
      .set('Authorization', bearer(member))
      .expect(403);
    expect(refused.body.error.message).toMatch(/created this task, or a team admin/);

    await request(app)
      .delete(`/api/tasks/${mine.id}`)
      .set('Authorization', bearer(member))
      .expect(204);
    // An admin may tidy up anybody's.
    await request(app)
      .delete(`/api/tasks/${theirs.id}`)
      .set('Authorization', bearer(admin))
      .expect(204);
    expect(await TaskModel.countDocuments({})).toBe(0);
  });

  it('keeps sample tasks: members can move them but not change or delete them', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const sample = await addTask(app, admin, board.id, { title: 'A sample task' });
    await TaskModel.updateOne({ _id: sample.id }, { $set: { seeded: true } });

    await request(app)
      .patch(`/api/tasks/${sample.id}`)
      .set('Authorization', bearer(member))
      .send({ title: 'lol' })
      .expect(403);
    await request(app)
      .delete(`/api/tasks/${sample.id}`)
      .set('Authorization', bearer(member))
      .expect(403);
    await move(member, sample.id, { columnId: board.columns[1]?.id ?? '' }).then((r) =>
      expect(r.status).toBe(200),
    );

    // An admin still can.
    await request(app)
      .patch(`/api/tasks/${sample.id}`)
      .set('Authorization', bearer(admin))
      .send({ title: 'A better sample' })
      .expect(200);
  });

  it('is invisible to people outside the team', async () => {
    const { member, outsider, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);
    const task = await addTask(app, member, board.id);

    await request(app)
      .get(`/api/tasks/${task.id}`)
      .set('Authorization', bearer(outsider))
      .expect(404);
    await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', bearer(outsider))
      .send({ title: 'x' })
      .expect(404);
    await move(outsider, task.id, { columnId: board.columns[1]?.id ?? '' }).then((r) =>
      expect(r.status).toBe(404),
    );
  });
});

describe('moving tasks', () => {
  async function boardWithThree() {
    const team = await teamWithMember(app);
    const { board } = await defaultBoard(app, team.member, team.teamId);
    const a = await addTask(app, team.member, board.id, { title: 'A' });
    const b = await addTask(app, team.member, board.id, { title: 'B' });
    const c = await addTask(app, team.member, board.id, { title: 'C' });
    const [todo, doing] = board.columns;
    if (!todo || !doing) throw new Error('Expected default columns');
    return { ...team, board, a, b, c, todo, doing };
  }

  it('reorders within a column by writing only the moved task', async () => {
    const { member, board, a, b, c, todo } = await boardWithThree();

    // C between A and B.
    const response = await move(member, c.id, { columnId: todo.id, afterId: a.id, beforeId: b.id });

    expect(response.status).toBe(200);
    const moved = taskMovedSchema.parse(response.body);
    expect(moved.task.order).toBeGreaterThan(a.order);
    expect(moved.task.order).toBeLessThan(b.order);
    expect(moved.task.version).toBe(2);
    expect(moved.reordered).toEqual([]);
    expect(columnTitles(await loadBoard(app, member, board.id), todo.id)).toEqual(['A', 'C', 'B']);

    // A and B were not written at all.
    const untouched = await TaskModel.find({ _id: { $in: [a.id, b.id] } });
    expect(untouched.map((task) => task.version)).toEqual([1, 1]);
  });

  it('moves across columns, to the top, between or to the bottom', async () => {
    const { member, board, a, b, c, todo, doing } = await boardWithThree();

    await move(member, b.id, { columnId: doing.id }); // an empty column
    await move(member, a.id, { columnId: doing.id, beforeId: b.id }); // top
    await move(member, c.id, { columnId: doing.id, afterId: b.id }); // bottom

    const detail = await loadBoard(app, member, board.id);
    expect(columnTitles(detail, todo.id)).toEqual([]);
    expect(columnTitles(detail, doing.id)).toEqual(['A', 'B', 'C']);
  });

  it('still lands where the person dropped it when their board was stale', async () => {
    const { admin, member, board, a, b, c, todo, doing } = await boardWithThree();
    // Somebody else moved B away a moment ago; this client still shows it.
    await move(admin, b.id, { columnId: doing.id });

    // "After A, before B" - B is no longer there, so after A it is.
    const response = await move(member, c.id, { columnId: todo.id, afterId: a.id, beforeId: b.id });
    expect(response.status).toBe(200);
    expect(columnTitles(await loadBoard(app, member, board.id), todo.id)).toEqual(['A', 'C']);
  });

  it('renumbers the column once repeated drops use up the gap', async () => {
    const { member, board, a, b, c, todo } = await boardWithThree();
    // A and B as close as doubles allow.
    await TaskModel.updateOne({ _id: b.id }, { $set: { order: a.order + 1e-9 } });

    const response = await move(member, c.id, { columnId: todo.id, afterId: a.id, beforeId: b.id });

    const moved = taskMovedSchema.parse(response.body);
    expect(moved.reordered.length).toBeGreaterThan(0);
    const detail = await loadBoard(app, member, board.id);
    expect(columnTitles(detail, todo.id)).toEqual(['A', 'C', 'B']);
    // Evenly spaced again, so the next drop has room.
    const orders = detail.tasks.map((task) => task.order).sort((x, y) => x - y);
    expect(orders).toEqual([1024, 2048, 3072]);
  });

  it('refuses a column from another board', async () => {
    const { member, a, board } = await boardWithThree();
    const response = await move(member, a.id, { columnId: board.id });
    expect(response.status).toBe(400);
  });

  it('marks the board as active, which the demo board’s reset waits on', async () => {
    const { member, a, doing, board } = await boardWithThree();
    await Board.updateOne({ _id: board.id }, { $set: { activityAt: null } });

    await move(member, a.id, { columnId: doing.id });

    expect((await Board.findById(board.id))?.activityAt).toBeInstanceOf(Date);
  });
});

describe('comments', () => {
  it('are listed oldest first, counted on the card, and notify whoever they mention', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);
    const task = await addTask(app, member, board.id, { title: 'Pick a date' });

    await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('Authorization', bearer(member))
      .send({ text: '@Ada can you confirm Thursday?' })
      .expect(201);
    const reply = await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('Authorization', bearer(admin))
      .send({ text: 'Thursday works. Thanks @grace hopper!' })
      .expect(201);
    expect(reply.body.commentCount).toBe(2);

    const list = await request(app)
      .get(`/api/tasks/${task.id}/comments`)
      .set('Authorization', bearer(member))
      .expect(200);
    expect(list.body.comments.map((c: { authorName: string }) => c.authorName)).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
    ]);

    const detail = await loadBoard(app, member, board.id);
    expect(detail.tasks[0]?.commentCount).toBe(2);

    const mentions = await Notification.find({ type: 'mention' }).sort({ createdAt: 1 });
    expect(mentions.map((n) => n.userId.toString())).toEqual([admin.id, member.id]);
    expect(mentions[0]).toMatchObject({
      title: 'Grace Hopper mentioned you in “Pick a date”',
      body: '@Ada can you confirm Thursday?',
    });
    expect(mentions[0]?.payload).toMatchObject({ taskId: task.id, boardId: board.id, teamId });
  });

  it('go with their task', async () => {
    const { member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, member, teamId);
    const task = await addTask(app, member, board.id);
    await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('Authorization', bearer(member))
      .send({ text: 'Started' });

    await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', bearer(member))
      .expect(204);

    const { TaskComment } = await import('./comment.model.js');
    expect(await TaskComment.countDocuments({})).toBe(0);
  });
});

describe('my tasks', () => {
  it('lists what is assigned to me across boards, with where each one is', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const second = (
      await request(app)
        .post('/api/boards')
        .set('Authorization', bearer(admin))
        .send({ teamId, name: 'Hiring' })
        .expect(201)
    ).body.board as { id: string; columns: { id: string }[] };

    await addTask(app, admin, board.id, {
      title: 'Due soon',
      assigneeId: member.id,
      dueDate: '2026-10-01',
    });
    await addTask(app, admin, second.id, {
      title: 'Finished',
      assigneeId: member.id,
      columnId: second.columns[3]?.id,
    });
    await addTask(app, admin, board.id, { title: 'Not mine', assigneeId: admin.id });

    const response = await request(app)
      .get('/api/tasks/mine')
      .set('Authorization', bearer(member))
      .expect(200);

    const tasks = response.body.tasks as (Task & { boardName: string; isDone: boolean })[];
    expect(tasks.map((task) => task.title).sort()).toEqual(['Due soon', 'Finished']);
    expect(tasks.find((task) => task.title === 'Finished')).toMatchObject({
      boardName: 'Hiring',
      columnTitle: 'Done',
      isDone: true,
    });
    expect(tasks.find((task) => task.title === 'Due soon')).toMatchObject({
      boardName: 'Team board',
      columnTitle: 'To Do',
      isDone: false,
    });
  });
});
