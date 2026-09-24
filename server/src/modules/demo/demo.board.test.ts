import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { meetingIntelligenceSchema, type AuthResponse, type Task } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { columnTitles, loadBoard } from '../../test/boards.js';
import { bearer, extractRefreshCookie, registerUser } from '../../test/fixtures.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Board } from '../tasks/board.model.js';
import { TaskComment } from '../tasks/comment.model.js';
import { Task as TaskModel } from '../tasks/task.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { DEMO_BOARD_KEY, SAMPLE_TASKS, restoreDemoBoard, seedDemoBoard } from './demo.board.js';
import { cleanupDemoData } from './demo.cleanup.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';
import { seedDemoMeetings } from './demo.meetings.js';

const app = createApp();
const HOUR = 60 * 60 * 1000;

/** What `npm run seed` builds: the persona, three team-mates (Ada an admin), meetings, board. */
async function seedWorkspace() {
  const persona = await registerUser(app, { name: 'Demo User', email: 'demo@intellmeet.app' });
  const ada = await registerUser(app, { name: 'Ada Lovelace', email: 'ada@intellmeet.app' });
  const grace = await registerUser(app, { name: 'Grace Hopper', email: 'grace@intellmeet.app' });
  const alan = await registerUser(app, { name: 'Alan Turing', email: 'alan@intellmeet.app' });
  await User.updateOne({ _id: persona.id }, { $set: { authProvider: 'demo' } });

  const team = await Team.create({
    name: 'IntellMeet Demo Team',
    slug: DEMO_TEAM_SLUG,
    ownerId: persona.id,
    members: [
      { userId: persona.id, role: 'admin' },
      { userId: ada.id, role: 'admin' },
      { userId: grace.id, role: 'member' },
      { userId: alan.id, role: 'member' },
    ],
  });

  const people = [persona, ada, grace, alan].map((user) => ({ id: user.id, name: user.name }));
  await seedDemoMeetings({ teamId: team._id.toString(), people });
  const { boardId } = await seedDemoBoard({ teamId: team._id.toString(), people });

  return { persona, ada, grace, alan, team, people, boardId };
}

/** "Try Live Demo". */
async function guest() {
  const response = await request(app).post('/api/auth/demo').expect(201);
  const auth = response.body as AuthResponse;
  return {
    id: auth.user.id,
    name: auth.user.name,
    accessToken: auth.accessToken,
    cookie: extractRefreshCookie(response.headers['set-cookie'] as unknown as string[]),
  };
}

async function sample(key: string) {
  const task = await TaskModel.findOne({ seedKey: `${DEMO_BOARD_KEY}:${key}` });
  if (!task) throw new Error(`No sample task ${key}`);
  return task;
}

describe('the seeded demo board', () => {
  it('is the team’s default board, with a sample task in every column', async () => {
    const { ada, boardId } = await seedWorkspace();

    const detail = await loadBoard(app, ada, boardId);

    expect(detail.board).toMatchObject({ name: 'Product board', isDefault: true, seeded: true });
    const [todo, doing, review, done] = detail.board.columns;
    expect(columnTitles(detail, todo?.id ?? '')).toHaveLength(2);
    expect(columnTitles(detail, doing?.id ?? '')).toEqual([
      'Fix the recording upload retry bug and merge it',
      'Triage the accessibility audit findings',
    ]);
    expect(columnTitles(detail, review?.id ?? '')).toHaveLength(1);
    expect(columnTitles(detail, done?.id ?? '')).toHaveLength(1);
    expect(detail.tasks.every((task) => task.seeded)).toBe(true);

    // Exactly one open task is overdue, on purpose, so the highlighting has
    // something to show without the whole team looking late. (Dates are
    // relative to the seed, so this holds whenever it runs.)
    const today = new Date().toISOString().slice(0, 10);
    const overdue = detail.tasks.filter(
      (task) => task.columnId !== done?.id && task.dueDate !== null && task.dueDate < today,
    );
    expect(overdue.map((task) => task.title)).toEqual(['Triage the accessibility audit findings']);
  });

  it('links three samples to the sample meetings’ action items, both ways', async () => {
    const { ada, boardId } = await seedWorkspace();
    const detail = await loadBoard(app, ada, boardId);
    const linked = detail.tasks.filter((task) => task.source !== null);
    expect(linked.map((task) => task.source?.meetingTitle).sort()).toEqual([
      'Design review: meeting summary page',
      'Q3 launch retrospective',
      'Sprint 14 planning',
    ]);

    const sprint = await Meeting.findOne({ seedKey: 'sprint-14-planning' });
    const response = await request(app)
      .get(`/api/meetings/${sprint?._id.toString()}/intelligence`)
      .set('Authorization', bearer(ada))
      .expect(200);
    const items = meetingIntelligenceSchema.parse(response.body).insight?.actionItems ?? [];
    expect(items[0]?.task).toMatchObject({ columnTitle: 'In Progress', isDone: false });
    // The rest are left for reviewers to turn into tasks themselves.
    expect(items.slice(1).every((item) => item.taskId === null)).toBe(true);
  });

  it('seeds again without duplicating, and keeps everyone’s links to sample items', async () => {
    const { team, people, grace, boardId } = await seedWorkspace();
    const sprint = await Meeting.findOne({ seedKey: 'sprint-14-planning' });
    const before = await request(app)
      .get(`/api/meetings/${sprint?._id.toString()}/intelligence`)
      .set('Authorization', bearer(grace));
    const vendorItem = before.body.insight.actionItems[1];
    // A reviewer turns a sample item into a task...
    await request(app)
      .post(`/api/meetings/${sprint?._id.toString()}/tasks`)
      .set('Authorization', bearer(grace))
      .send({ items: [{ actionItemId: vendorItem.id, assigneeId: null, dueDate: null }] })
      .expect(201);

    // ...and then the seed runs again (a deploy, or somebody tidying up).
    await seedDemoMeetings({ teamId: team._id.toString(), people });
    await seedDemoBoard({ teamId: team._id.toString(), people });

    expect(await Board.countDocuments({})).toBe(1);
    expect(await TaskModel.countDocuments({ seeded: true })).toBe(SAMPLE_TASKS.length);
    const after = await request(app)
      .get(`/api/meetings/${sprint?._id.toString()}/intelligence`)
      .set('Authorization', bearer(grace));
    // Same item id, same task: stable ids are what keep this link alive.
    expect(after.body.insight.actionItems[1]).toMatchObject({ id: vendorItem.id });
    expect(after.body.insight.actionItems[1].taskId).not.toBeNull();
    expect((await loadBoard(app, grace, boardId)).tasks).toHaveLength(SAMPLE_TASKS.length + 1);
  });
});

describe('reviewers sharing the demo board', () => {
  it('can move a sample task, but not change or delete it', async () => {
    const { boardId } = await seedWorkspace();
    const judge = await guest();
    const task = await sample('release-notes');
    const board = await Board.findById(boardId);

    await request(app)
      .post(`/api/tasks/${task._id.toString()}/move`)
      .set('Authorization', bearer(judge))
      .send({ columnId: board?.columns[3]?._id.toString() })
      .expect(200);
    await request(app)
      .patch(`/api/tasks/${task._id.toString()}`)
      .set('Authorization', bearer(judge))
      .send({ title: 'lol' })
      .expect(403);
    await request(app)
      .delete(`/api/tasks/${task._id.toString()}`)
      .set('Authorization', bearer(judge))
      .expect(403);
  });

  it('can add and delete their own tasks, but not one another’s', async () => {
    const { boardId } = await seedWorkspace();
    const first = await guest();
    const second = await guest();

    const made = await request(app)
      .post(`/api/boards/${boardId}/tasks`)
      .set('Authorization', bearer(first))
      .send({ title: 'Try the board' })
      .expect(201);
    const taskId = (made.body.task as Task).id;

    await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', bearer(second))
      .expect(403);
    await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set('Authorization', bearer(first))
      .expect(204);
  });

  it('cannot rename, reorder or remove the shared columns', async () => {
    const { boardId } = await seedWorkspace();
    const judge = await guest();
    const board = await Board.findById(boardId);
    const done = board?.columns[3]?._id.toString();

    await request(app)
      .patch(`/api/boards/${boardId}/columns/${done}`)
      .set('Authorization', bearer(judge))
      .send({ title: 'asdf' })
      .expect(403);
    await request(app)
      .delete(`/api/boards/${boardId}/columns/${done}`)
      .set('Authorization', bearer(judge))
      .expect(403);
    await request(app)
      .post(`/api/boards/${boardId}/columns`)
      .set('Authorization', bearer(judge))
      .send({ title: 'Mine' })
      .expect(403);
  });
});

describe('demo cleanup and the board', () => {
  it('takes a leaving guest’s tasks and comments with it, and never a sample', async () => {
    const { boardId, grace } = await seedWorkspace();
    const judge = await guest();
    const other = await guest();

    const mine = await request(app)
      .post(`/api/boards/${boardId}/tasks`)
      .set('Authorization', bearer(judge))
      .send({ title: 'E2E judge task' })
      .expect(201);
    // Somebody else gave the judge a task: it stays, unassigned.
    const given = await request(app)
      .post(`/api/boards/${boardId}/tasks`)
      .set('Authorization', bearer(other))
      .send({ title: 'For the judge', assigneeId: judge.id })
      .expect(201);
    const releaseNotes = await sample('release-notes');
    await request(app)
      .post(`/api/tasks/${releaseNotes._id.toString()}/comments`)
      .set('Authorization', bearer(judge))
      .send({ text: 'Looks good' })
      .expect(201);
    await request(app)
      .post(`/api/tasks/${releaseNotes._id.toString()}/comments`)
      .set('Authorization', bearer(grace))
      .send({ text: 'Thanks' })
      .expect(201);

    // "End demo session".
    await request(app).delete('/api/auth/demo').set('Authorization', bearer(judge)).expect(204);

    expect(await TaskModel.exists({ _id: mine.body.task.id })).toBeNull();
    const kept = await TaskModel.findById(given.body.task.id);
    expect(kept?.assigneeId).toBeNull();
    expect((await TaskComment.find({})).map((comment) => comment.text)).toEqual(['Thanks']);
    expect(await TaskModel.countDocuments({ seeded: true })).toBe(SAMPLE_TASKS.length);
  });

  it('never removes the samples, even when asked to sweep everything', async () => {
    await seedWorkspace();
    // A sample is created by the seeded persona, like the stale content the
    // sweep does remove: age and author alone must not be enough.
    await TaskModel.updateMany({ seeded: true }, { $set: { createdAt: new Date(0) } });

    const result = await cleanupDemoData({ olderThanHours: 0 });

    expect(result.tasks).toBe(0);
    expect(await TaskModel.countDocuments({ seeded: true })).toBe(SAMPLE_TASKS.length);
    expect(await Board.countDocuments({ seedKey: DEMO_BOARD_KEY })).toBe(1);
  });
});

describe('putting the samples back', () => {
  async function moveReleaseNotesToDone(boardId: string) {
    const judge = await guest();
    const board = await Board.findById(boardId);
    const task = await sample('release-notes');
    await request(app)
      .post(`/api/tasks/${task._id.toString()}/move`)
      .set('Authorization', bearer(judge))
      .send({ columnId: board?.columns[3]?._id.toString() })
      .expect(200);
    return { board, task };
  }

  it('waits while the board is in use', async () => {
    const { boardId } = await seedWorkspace();
    await moveReleaseNotesToDone(boardId);

    expect(await restoreDemoBoard({ idleMinutes: 60 })).toBe(false);
    const task = await sample('release-notes');
    expect(task.columnId.toString()).toBe(
      (await Board.findById(boardId))?.columns[3]?._id.toString(),
    );
  });

  it('puts them back once the board has been quiet, and only once', async () => {
    const { boardId, ada } = await seedWorkspace();
    const { board, task: releaseNotes } = await moveReleaseNotesToDone(boardId);
    // An admin renamed a column too, and somebody commented on a sample.
    await request(app)
      .patch(`/api/boards/${boardId}/columns/${board?.columns[2]?._id.toString()}`)
      .set('Authorization', bearer(ada))
      .send({ title: 'QA' })
      .expect(200);
    await request(app)
      .post(`/api/tasks/${releaseNotes._id.toString()}/comments`)
      .set('Authorization', bearer(ada))
      .send({ text: 'testing 123' })
      .expect(201);
    // Seeded three hours ago, last touched two hours ago, quiet since.
    await Board.updateOne(
      { _id: boardId },
      {
        $set: {
          restoredAt: new Date(Date.now() - 3 * HOUR),
          activityAt: new Date(Date.now() - 2 * HOUR),
        },
      },
    );

    expect(await restoreDemoBoard({ idleMinutes: 60 })).toBe(true);

    const detail = await loadBoard(app, ada, boardId);
    expect(detail.board.columns.map((column) => column.title)).toEqual([
      'To Do',
      'In Progress',
      'Review',
      'Done',
    ]);
    expect(columnTitles(detail, detail.board.columns[0]?.id ?? '')).toContain(
      'Write the release notes for 1.4',
    );
    expect(await TaskComment.countDocuments({ taskId: releaseNotes._id })).toBe(0);

    // Nothing has happened since: no second reset.
    expect(await restoreDemoBoard({ idleMinutes: 60 })).toBe(false);
  });

  it('counts a comment as somebody using the board', async () => {
    const { boardId, grace } = await seedWorkspace();
    await Board.updateOne(
      { _id: boardId },
      {
        $set: {
          restoredAt: new Date(Date.now() - 3 * HOUR),
          activityAt: new Date(Date.now() - 2 * HOUR),
        },
      },
    );
    const releaseNotes = await sample('release-notes');

    await request(app)
      .post(`/api/tasks/${releaseNotes._id.toString()}/comments`)
      .set('Authorization', bearer(grace))
      .send({ text: 'Mid-conversation' })
      .expect(201);

    expect(await restoreDemoBoard({ idleMinutes: 60 })).toBe(false);
    expect(await TaskComment.countDocuments({})).toBe(1);
  });

  it('leaves an untouched board alone', async () => {
    await seedWorkspace();
    expect(await restoreDemoBoard({ idleMinutes: 0 })).toBe(false);
  });

  it('can be forced, for clearing the decks before a demo', async () => {
    const { boardId } = await seedWorkspace();
    await moveReleaseNotesToDone(boardId);

    expect(await restoreDemoBoard({ force: true })).toBe(true);
    const task = await sample('release-notes');
    expect(task.columnId.toString()).toBe(
      (await Board.findById(boardId))?.columns[0]?._id.toString(),
    );
  });
});
