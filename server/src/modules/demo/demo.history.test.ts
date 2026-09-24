import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { AnalyticsMembers, AnalyticsOverview, AnalyticsWeekly } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { getRedis } from '../../config/redis.js';
import { bearer, registerUser } from '../../test/fixtures.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Transcript } from '../ai/transcript.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Board } from '../tasks/board.model.js';
import { Task } from '../tasks/task.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { DEMO_BOARD_KEY, seedDemoBoard } from './demo.board.js';
import { cleanupDemoData } from './demo.cleanup.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';
import { HISTORY_MEETINGS, historyTasks } from './demo.history.data.js';
import { historyTranscript, refreshDemoHistory, seedDemoHistory } from './demo.history.js';
import { loadMeetingFixtures, seedDemoMeetings } from './demo.meetings.js';

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

/** A Thursday. The history is placed relative to its week (Monday 21 Sep). */
const NOW = new Date('2026-09-24T12:00:00Z');

const HISTORY = { seeded: true, seedKey: /^history-/ };

/** What `npm run seed` builds, at `now`. */
async function seedWorkspace(now = NOW) {
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
  await seedDemoMeetings({ teamId: team._id.toString(), people, now });
  const history = await seedDemoHistory({ teamId: team._id, people, now });
  const board = await seedDemoBoard({ teamId: team._id, people, now });

  return { persona, ada, grace, alan, team, people, history, board };
}

async function startDates(): Promise<Map<string, number>> {
  const meetings = await Meeting.find(HISTORY).select('seedKey startedAt');
  return new Map(
    meetings.map((meeting) => [meeting.seedKey ?? '', meeting.startedAt?.getTime() ?? 0]),
  );
}

describe('the seeded history', () => {
  it('is eight weeks of short meetings, none of them empty', async () => {
    const { history } = await seedWorkspace();
    expect(history).toEqual({ created: HISTORY_MEETINGS.length, updated: 0, removed: 0 });

    const meetings = await Meeting.find(HISTORY).sort({ startedAt: 1 });
    expect(meetings).toHaveLength(HISTORY_MEETINGS.length);
    // Ended, summarised, and with people in them, like any recorded meeting.
    for (const meeting of meetings) {
      expect(meeting.status).toBe('ended');
      expect(meeting.aiStatus).toBe('done');
      expect(meeting.participants.length).toBeGreaterThanOrEqual(2);
      expect(meeting.endedAt?.getTime()).toBeGreaterThan(meeting.startedAt?.getTime() ?? 0);
    }

    // From eight weeks back to last week: the week the seed runs in is left
    // to the detailed samples and to whoever uses the demo.
    const monday = new Date('2026-09-21T00:00:00Z').getTime();
    expect(meetings[0]?.startedAt?.getTime()).toBeGreaterThanOrEqual(monday - 8 * 7 * DAY);
    expect(meetings.at(-1)?.startedAt?.getTime()).toBeLessThan(monday);
    expect(meetings.at(-1)?.startedAt?.getTime()).toBeGreaterThanOrEqual(monday - 7 * DAY);

    const ids = meetings.map((meeting) => meeting._id);
    const insights = await MeetingInsight.find({ meetingId: { $in: ids } });
    const transcripts = await Transcript.find({ meetingId: { $in: ids } });
    expect(insights).toHaveLength(meetings.length);
    expect(transcripts).toHaveLength(meetings.length);
    for (const insight of insights) {
      expect(insight.summary.length).toBeGreaterThan(40);
      expect(insight.actionItems.length).toBeGreaterThan(0);
      // Every owner is a real team-mate, so the items show a name and link.
      for (const item of insight.actionItems) expect(item.assigneeId).not.toBeNull();
    }
  });

  it('says in its transcripts what its minutes say', () => {
    for (const meeting of HISTORY_MEETINGS) {
      const segments = historyTranscript(meeting, NOW);
      expect(segments[0]).toMatchObject({ speaker: meeting.host, text: meeting.opening });
      // Each owner takes their own item, in their own words.
      for (const item of meeting.actionItems) {
        const said = `I'll ${item.text.charAt(0).toLowerCase()}${item.text.slice(1)}`;
        const line = segments.find(
          (segment) => segment.speaker === item.owner && segment.text.startsWith(said),
        );
        expect(line, `${meeting.key}: ${item.text}`).toBeDefined();
      }
      // In order, and inside the meeting.
      for (const [index, segment] of segments.entries()) {
        expect(segment.end).toBeGreaterThan(segment.start);
        expect(segment.end).toBeLessThanOrEqual(meeting.minutes * 60);
        if (index > 0) expect(segment.start).toBeGreaterThan(segments[index - 1]?.start ?? 0);
      }
      // Only people who were there speak.
      for (const segment of segments) expect(meeting.attendees).toContain(segment.speaker);
    }
  });

  it('finished some of its action items as tasks, in "Done", linked both ways', async () => {
    const { board } = await seedWorkspace();
    expect(board.historyTasks).toBe(historyTasks().length);

    const detail = await Board.findOne({ seedKey: DEMO_BOARD_KEY });
    const done = detail?.columns.find((column) => column.isDone);
    const tasks = await Task.find({ seedKey: /^demo-board:history:/ }).sort({ order: 1 });
    expect(tasks).toHaveLength(historyTasks().length);

    for (const task of tasks) {
      expect(task.seeded).toBe(true);
      expect(task.columnId.equals(done?._id)).toBe(true);
      const insight = await MeetingInsight.findOne({ meetingId: task.sourceMeetingId }).lean();
      const item = insight?.actionItems.find((entry) => entry._id.equals(task.sourceActionItemId));
      expect(item?.taskId?.equals(task._id)).toBe(true);
      expect(item?.status).toBe('done');
      // Made just after the meeting it came from.
      const meeting = await Meeting.findById(task.sourceMeetingId);
      expect(task.createdAt.getTime()).toBeGreaterThan(meeting?.endedAt?.getTime() ?? Infinity);
    }

    // Below the sample in "Done", newest first.
    const sample = await Task.findOne({ seedKey: `${DEMO_BOARD_KEY}:launch-checklist` });
    expect(tasks[0]?.order).toBeGreaterThan(sample?.order ?? Infinity);
    const created = tasks.map((task) => task.createdAt.getTime());
    expect(created).toEqual([...created].sort((a, b) => b - a));
  });

  it('seeds again without duplicating anything', async () => {
    const { team, people } = await seedWorkspace();
    const before = await MeetingInsight.find({}).select('actionItems._id').lean();

    expect(await seedDemoHistory({ teamId: team._id, people, now: NOW })).toEqual({
      created: 0,
      updated: HISTORY_MEETINGS.length,
      removed: 0,
    });
    await seedDemoBoard({ teamId: team._id, people, now: NOW });

    expect(await Meeting.countDocuments(HISTORY)).toBe(HISTORY_MEETINGS.length);
    expect(await MeetingInsight.countDocuments()).toBe(HISTORY_MEETINGS.length + 3);
    expect(await Transcript.countDocuments()).toBe(HISTORY_MEETINGS.length + 3);
    expect(await Task.countDocuments({ seeded: true })).toBe(6 + historyTasks().length);
    // The same item ids, so every link to them survives.
    const after = await MeetingInsight.find({}).select('actionItems._id').lean();
    const idsOf = (list: typeof before) =>
      list.flatMap((insight) => insight.actionItems.map((item) => item._id.toString())).sort();
    expect(idsOf(after)).toEqual(idsOf(before));
  });

  it('keeps the link when a reviewer made a task from an open item', async () => {
    const { team, people, grace } = await seedWorkspace();
    const meeting = await Meeting.findOne({ seedKey: 'history-w3-product-sync' });
    const insight = await MeetingInsight.findOne({ meetingId: meeting?._id }).lean();
    const open = insight?.actionItems.find((item) => item.status === 'open' && !item.taskId);
    if (!meeting || !open) throw new Error('Expected an open history item');

    const created = await request(app)
      .post(`/api/meetings/${meeting._id.toString()}/tasks`)
      .set('Authorization', bearer(grace))
      .send({ items: [{ actionItemId: open._id.toString(), assigneeId: null, dueDate: null }] })
      .expect(201);
    const taskId = created.body.tasks[0].id as string;

    await seedDemoHistory({ teamId: team._id, people, now: NOW });
    await seedDemoBoard({ teamId: team._id, people, now: NOW });

    const after = await MeetingInsight.findOne({ meetingId: meeting._id }).lean();
    const item = after?.actionItems.find((entry) => entry._id.equals(open._id));
    expect(item?.taskId?.toString()).toBe(taskId);
  });

  it('moves forward by whole weeks, never duplicating', async () => {
    const { team, people } = await seedWorkspace();
    const before = await startDates();
    const tasksBefore = await Task.find({ seedKey: /^demo-board:history:/ }).lean();

    const nextWeek = new Date(NOW.getTime() + 7 * DAY);
    await seedDemoHistory({ teamId: team._id, people, now: nextWeek });
    await seedDemoBoard({ teamId: team._id, people, now: nextWeek });

    const after = await startDates();
    expect(after.size).toBe(before.size);
    for (const [key, time] of before) {
      expect(after.get(key)).toBe(time + 7 * DAY);
    }
    // `createdAt` too, which the history's "All" filter sorts by. (Mongoose
    // treats it as immutable, so a plain `$set` would silently not move it.)
    for (const meeting of await Meeting.find({ seeded: true })) {
      expect(meeting.createdAt.getTime(), meeting.seedKey ?? '').toBe(meeting.startedAt?.getTime());
    }

    // The finished tasks and their due dates follow their meetings.
    for (const task of tasksBefore) {
      const moved = await Task.findById(task._id).lean();
      expect(moved?.createdAt.getTime()).toBe(task.createdAt.getTime() + 7 * DAY);
      if (task.dueDate) {
        const due = new Date(`${task.dueDate}T00:00:00Z`).getTime();
        expect(moved?.dueDate).toBe(new Date(due + 7 * DAY).toISOString().slice(0, 10));
      }
    }

    // A few days later in the same week, nothing moves.
    await seedDemoHistory({
      teamId: team._id,
      people,
      now: new Date(nextWeek.getTime() + 2 * DAY),
    });
    expect(await startDates()).toEqual(after);
  });

  it('is never deleted by the demo cleanup, however old', async () => {
    await seedWorkspace();
    const tasks = await Task.countDocuments({ seedKey: /^demo-board:history:/ });

    await cleanupDemoData({ olderThanHours: 0 });

    expect(await Meeting.countDocuments(HISTORY)).toBe(HISTORY_MEETINGS.length);
    expect(await MeetingInsight.countDocuments()).toBe(HISTORY_MEETINGS.length + 3);
    expect(await Transcript.countDocuments()).toBe(HISTORY_MEETINGS.length + 3);
    expect(await Task.countDocuments({ seedKey: /^demo-board:history:/ })).toBe(tasks);
  });

  it('retires meetings and tasks the history data no longer has', async () => {
    const { team, people, persona } = await seedWorkspace();
    const board = await Board.findOne({ seedKey: DEMO_BOARD_KEY });
    const gone = await Meeting.create({
      teamId: team._id,
      title: 'Taken out of the data',
      hostId: persona.id,
      roomCode: 'GONE234',
      status: 'ended',
      seeded: true,
      seedKey: 'history-taken-out',
    });
    await MeetingInsight.create({ meetingId: gone._id, summary: 'Old', provider: 'seed' });
    await Task.create({
      boardId: board?._id,
      teamId: team._id,
      columnId: board?.columns[3]?._id,
      title: 'Old task',
      order: 1,
      createdBy: persona.id,
      seeded: true,
      seedKey: 'demo-board:history:taken-out:0',
    });

    const result = await seedDemoHistory({ teamId: team._id, people, now: NOW });
    await seedDemoBoard({ teamId: team._id, people, now: NOW });

    expect(result.removed).toBe(1);
    expect(await Meeting.exists({ _id: gone._id })).toBeNull();
    expect(await MeetingInsight.exists({ meetingId: gone._id })).toBeNull();
    expect(await Task.exists({ seedKey: 'demo-board:history:taken-out:0' })).toBeNull();
    // Nothing that is still in the data went with them.
    expect(await Meeting.countDocuments(HISTORY)).toBe(HISTORY_MEETINGS.length);
    expect(await Task.countDocuments({ seedKey: /^demo-board:history:/ })).toBe(
      historyTasks().length,
    );
  });

  it('leaves the end-to-end searches their first page', async () => {
    const fixtures = await loadMeetingFixtures();
    const text = (parts: string[]) => parts.join(' ').toLowerCase();
    const history = HISTORY_MEETINGS.map((meeting) =>
      text([
        meeting.title,
        meeting.summary,
        ...meeting.decisions,
        ...historyTranscript(meeting, NOW).map((segment) => segment.text),
        ...meeting.actionItems.map((item) => item.text),
      ]),
    );
    for (const word of ['pricing', 'interviews']) {
      expect(history.filter((entry) => entry.includes(word))).toEqual([]);
    }
    // History pages hold ten meetings; "sprint" must find Sprint 14 on the first.
    const samples = fixtures.map((fixture) =>
      text([
        fixture.title,
        fixture.reference.summary,
        ...fixture.segments.map((segment) => segment.text),
      ]),
    );
    const sprint = [...history, ...samples].filter((entry) => entry.includes('sprint'));
    expect(sprint.length).toBeLessThanOrEqual(10);
  });

  it('gives every chart something to show', async () => {
    const { persona, team } = await seedWorkspace();
    const query = `teamId=${team._id.toString()}&from=2026-08-03&to=2026-09-24&tz=UTC`;
    const read = async <T>(endpoint: string) =>
      (
        await request(app)
          .get(`/api/analytics/${endpoint}?${query}`)
          .set('Authorization', bearer(persona))
          .expect(200)
      ).body as T;

    const weekly = await read<AnalyticsWeekly>('weekly');
    expect(weekly.weeks).toHaveLength(8);
    for (const week of weekly.weeks) expect(week.meetings, week.week).toBeGreaterThan(0);
    // Not flat: busy weeks and a quiet one.
    const counts = weekly.weeks.map((week) => week.meetings);
    expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThanOrEqual(2);
    // Older weeks' action items are mostly done; the newest are mostly open.
    const first = weekly.weeks[0];
    const last = weekly.weeks.at(-1);
    expect(first?.actionItemsCompleted).toBe(first?.actionItemsCreated);
    expect(last?.actionItemsCompleted).toBeLessThan(last?.actionItemsCreated ?? 0);

    const overview = await read<AnalyticsOverview>('overview');
    expect(overview.meetings.count).toBeGreaterThanOrEqual(20);
    expect(overview.meetings.averageParticipants).toBeGreaterThan(3);
    expect(overview.actionItems.created).toBeGreaterThan(40);
    expect(overview.tasks.completionRate).toBeGreaterThan(0.5);
    expect(overview.tasks.completionRate).toBeLessThan(1);

    const { members } = await read<AnalyticsMembers>('members');
    expect(members.map((member) => member.name).sort()).toEqual([
      'Ada Lovelace',
      'Alan Turing',
      'Demo User',
      'Grace Hopper',
    ]);
    // Everyone has tasks, and not everyone has finished all of them.
    for (const member of members) expect(member.completionRate).not.toBeNull();
    expect(new Set(members.map((member) => member.completionRate)).size).toBeGreaterThan(1);
  });
});

describe('keeping the history recent', () => {
  it('does nothing on a database that was never seeded', async () => {
    expect(await refreshDemoHistory({ now: NOW })).toBe(false);
    expect(await Meeting.countDocuments()).toBe(0);
  });

  it('does nothing while the history is placed for this week', async () => {
    await seedWorkspace();
    expect(await refreshDemoHistory({ now: new Date(NOW.getTime() + 3 * DAY) })).toBe(false);
  });

  it('fills the history in on a database seeded before it existed', async () => {
    const { team } = await seedWorkspace();
    await Meeting.deleteMany(HISTORY);

    expect(await refreshDemoHistory({ now: NOW })).toBe(true);
    expect(await Meeting.countDocuments({ ...HISTORY, teamId: team._id })).toBe(
      HISTORY_MEETINGS.length,
    );
  });

  it('moves everything forward once a week, and tells the analytics', async () => {
    const { team } = await seedWorkspace();
    const before = await startDates();
    const sample = await Task.findOne({ seedKey: `${DEMO_BOARD_KEY}:a11y-triage` }).lean();
    const generation = `analytics:gen:${team._id.toString()}`;
    const genBefore = Number((await getRedis().get(generation)) ?? 0);

    const nextWeek = new Date(NOW.getTime() + 7 * DAY);
    expect(await refreshDemoHistory({ now: nextWeek })).toBe(true);

    for (const [key, time] of await startDates())
      expect(time).toBe((before.get(key) ?? 0) + 7 * DAY);
    // The quiet board is re-dated with it: the overdue sample is still two days late.
    const moved = await Task.findOne({ seedKey: `${DEMO_BOARD_KEY}:a11y-triage` }).lean();
    expect(moved?.dueDate).toBe('2026-09-29');
    expect(moved?.dueDate).not.toBe(sample?.dueDate);
    expect(Number(await getRedis().get(generation))).toBeGreaterThan(genBefore);
  });

  it('leaves a board somebody is using for its own reset', async () => {
    await seedWorkspace();
    const nextWeek = new Date(NOW.getTime() + 7 * DAY);
    await Board.updateOne({ seedKey: DEMO_BOARD_KEY }, { $set: { activityAt: nextWeek } });
    const sample = await Task.findOne({ seedKey: `${DEMO_BOARD_KEY}:a11y-triage` }).lean();

    expect(await refreshDemoHistory({ now: nextWeek })).toBe(true);

    const untouched = await Task.findOne({ seedKey: `${DEMO_BOARD_KEY}:a11y-triage` }).lean();
    expect(untouched?.dueDate).toBe(sample?.dueDate);
    expect(untouched?.version).toBe(sample?.version);
  });
});
