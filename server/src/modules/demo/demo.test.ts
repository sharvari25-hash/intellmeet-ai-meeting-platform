import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Message } from '../chat/message.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { runQuickSweep, startHousekeeping, stopHousekeeping } from '../../jobs/housekeeping.js';
import { cleanupDemoData } from './demo.cleanup.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Transcript } from '../ai/transcript.model.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';
import { loadMeetingFixtures, seedDemoMeetings, weeksToShift } from './demo.meetings.js';

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

/** The seeded demo persona, plus a real account that must never be swept. */
async function seedAccounts() {
  const demo = await User.create({
    name: 'Demo User',
    email: 'demo@intellmeet.app',
    passwordHash: 'x',
    authProvider: 'demo',
  });

  const real = await User.create({
    name: 'Ada Lovelace',
    email: 'ada@intellmeet.app',
    passwordHash: 'x',
    authProvider: 'local',
  });

  const seededTeam = await Team.create({
    name: 'IntellMeet Demo Team',
    slug: DEMO_TEAM_SLUG,
    ownerId: demo._id,
    members: [{ userId: demo._id, role: 'admin', joinedAt: new Date() }],
  });

  return { demo, real, seededTeam };
}

/**
 * `createdAt` is set by Mongoose timestamps, so an "old" document has to be
 * backdated after the fact.
 */
async function backdate(
  model: typeof Meeting | typeof Team | typeof Notification,
  id: Types.ObjectId,
  hours: number,
): Promise<void> {
  await model.collection.updateOne({ _id: id }, { $set: { createdAt: ago(hours) } });
}

async function createMeeting(
  teamId: Types.ObjectId,
  hostId: Types.ObjectId,
  roomCode: string,
  ageHours: number,
) {
  const meeting = await Meeting.create({
    teamId,
    title: `Meeting ${roomCode}`,
    hostId,
    roomCode,
    status: 'ended',
  });
  await backdate(Meeting, meeting._id, ageHours);
  return meeting;
}

describe('demo workspace cleanup', () => {
  it('removes meetings the demo account left behind', async () => {
    const { demo, seededTeam } = await seedAccounts();
    await createMeeting(seededTeam._id, demo._id, 'OLD1234', 10);

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.meetings).toBe(1);
    expect(await Meeting.countDocuments({})).toBe(0);
  });

  it('leaves recent meetings alone so nobody is swept out mid-demo', async () => {
    const { demo, seededTeam } = await seedAccounts();
    await createMeeting(seededTeam._id, demo._id, 'NEW1234', 1);

    const result = await cleanupDemoData({ olderThanHours: 6 });

    // This is the whole reason the job is age-based rather than a reset
    // button: reviewers share one workspace and one of them is always mid-call.
    expect(result.meetings).toBe(0);
    expect(await Meeting.countDocuments({})).toBe(1);
  });

  it('never removes the seeded team, however old it is', async () => {
    const { seededTeam } = await seedAccounts();
    await backdate(Team, seededTeam._id, 24 * 30);

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.teams).toBe(0);
    expect(await Team.findOne({ slug: DEMO_TEAM_SLUG })).not.toBeNull();
  });

  it('removes throwaway teams the demo account created', async () => {
    const { demo } = await seedAccounts();

    const scratch = await Team.create({
      name: 'asdf',
      slug: 'asdf',
      ownerId: demo._id,
      members: [{ userId: demo._id, role: 'admin', joinedAt: new Date() }],
    });
    await backdate(Team, scratch._id, 10);

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.teams).toBe(1);
    expect(await Team.countDocuments({})).toBe(1);
  });

  it('takes the meetings inside a removed team with it, whatever their age', async () => {
    const { demo } = await seedAccounts();

    const scratch = await Team.create({
      name: 'scratch',
      slug: 'scratch',
      ownerId: demo._id,
      members: [{ userId: demo._id, role: 'admin', joinedAt: new Date() }],
    });
    await backdate(Team, scratch._id, 10);

    // Brand new, but its team is going - leaving it would orphan it.
    await createMeeting(scratch._id, demo._id, 'FRESH12', 0);

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.teams).toBe(1);
    expect(result.meetings).toBe(1);
    expect(await Meeting.countDocuments({})).toBe(0);
  });

  it('deletes the chat history of a removed meeting', async () => {
    const { demo, seededTeam } = await seedAccounts();
    const meeting = await createMeeting(seededTeam._id, demo._id, 'CHAT123', 10);

    await Message.create({ meetingId: meeting._id, senderId: demo._id, text: 'hello' });
    await Message.create({ meetingId: meeting._id, senderId: demo._id, text: 'goodbye' });

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.messages).toBe(2);
    expect(await Message.countDocuments({})).toBe(0);
  });

  it('never touches a real account, its team or its meetings', async () => {
    const { real } = await seedAccounts();

    const realTeam = await Team.create({
      name: 'Platform',
      slug: 'platform',
      ownerId: real._id,
      members: [{ userId: real._id, role: 'admin', joinedAt: new Date() }],
    });
    await backdate(Team, realTeam._id, 24 * 30);
    await createMeeting(realTeam._id, real._id, 'REAL123', 24 * 30);

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result).toEqual({
      guests: 0,
      meetings: 0,
      messages: 0,
      teams: 0,
      tasks: 0,
      notifications: 0,
    });
    expect(await Team.countDocuments({ slug: 'platform' })).toBe(1);
    expect(await Meeting.countDocuments({ roomCode: 'REAL123' })).toBe(1);
  });

  it('clears the demo account stale notifications but keeps recent ones', async () => {
    const { demo } = await seedAccounts();

    const old = await Notification.create({
      userId: demo._id,
      type: 'meeting_started',
      title: 'Meeting started',
      body: 'old',
    });
    await backdate(Notification, old._id, 10);

    await Notification.create({
      userId: demo._id,
      type: 'meeting_started',
      title: 'Meeting started',
      body: 'recent',
    });

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.notifications).toBe(1);
    expect(await Notification.countDocuments({})).toBe(1);
  });

  it('does nothing on a database with no demo account', async () => {
    await User.create({
      name: 'Ada',
      email: 'ada@example.com',
      passwordHash: 'x',
      authProvider: 'local',
    });

    await expect(cleanupDemoData({ olderThanHours: 0 })).resolves.toEqual({
      guests: 0,
      meetings: 0,
      messages: 0,
      teams: 0,
      tasks: 0,
      notifications: 0,
    });
  });

  it('sweeps everything but the seed when asked for an age of zero', async () => {
    const { demo, seededTeam } = await seedAccounts();
    // A minute old: far inside any real TTL, so only an age of zero sweeps it.
    // Not 0 - stamped from `Date.now()` just before the cutoff is, it lands on
    // the cutoff itself whenever both reads share a millisecond, and `$lt`
    // rightly leaves a meeting no older than the cutoff alone.
    await createMeeting(seededTeam._id, demo._id, 'RIGHTNW', 1 / 60);

    // What `npm run demo:cleanup -- 0` does, right before a presentation.
    const result = await cleanupDemoData({ olderThanHours: 0 });

    expect(result.meetings).toBe(1);
    expect(await Team.findOne({ slug: DEMO_TEAM_SLUG })).not.toBeNull();
    expect(await User.countDocuments({})).toBe(2);
  });
});

describe('cleanup scheduling', () => {
  it('does not start a background timer under test', () => {
    // The guard matters: a timer running during the suite would delete data
    // out from under unrelated tests, and would keep vitest alive after they
    // finished. `stopHousekeeping` is therefore also a no-op here.
    expect(() => {
      startHousekeeping();
      stopHousekeeping();
    }).not.toThrow();
  });

  it('runs the frequent pass without throwing, even with nothing to do', async () => {
    // No socket server and no demo board: each job has nothing to act on,
    // and a job that fails must be logged rather than take the process down.
    await expect(runQuickSweep()).resolves.toBeUndefined();
  });
});

describe('seeded past meetings', () => {
  /** The demo account plus the three teammates the fixtures mention. */
  async function seedPeople() {
    const { demo, seededTeam } = await seedAccounts();
    const names = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'];
    const mates = await Promise.all(
      names.map((name, index) =>
        User.create({
          name,
          email: `mate${index}@intellmeet.app`,
          passwordHash: 'x',
          authProvider: 'local',
        }),
      ),
    );

    const people = [demo, ...mates].map((user) => ({ id: user._id.toString(), name: user.name }));
    return { demo, seededTeam, people };
  }

  it('creates the sample meetings with transcripts and summaries', async () => {
    const { seededTeam, people } = await seedPeople();

    const result = await seedDemoMeetings({ teamId: seededTeam._id.toString(), people });

    expect(result).toEqual({ created: 3, updated: 0 });

    const meetings = await Meeting.find({ seeded: true });
    expect(meetings).toHaveLength(3);
    for (const meeting of meetings) {
      expect(meeting.status).toBe('ended');
      expect(meeting.aiStatus).toBe('done');
      expect(meeting.teamId.toString()).toBe(seededTeam._id.toString());
    }

    expect(await Transcript.countDocuments({})).toBe(3);
    const insights = await MeetingInsight.find({});
    expect(insights).toHaveLength(3);

    // Every reference owner is one of the seeded people, so each resolves.
    const items = insights.flatMap((insight) => insight.actionItems);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.assigneeId !== null)).toBe(true);
  });

  it('is idempotent: a second run refreshes rather than duplicates', async () => {
    const { seededTeam, people } = await seedPeople();

    await seedDemoMeetings({ teamId: seededTeam._id.toString(), people });
    const second = await seedDemoMeetings({ teamId: seededTeam._id.toString(), people });

    expect(second).toEqual({ created: 0, updated: 3 });
    expect(await Meeting.countDocuments({})).toBe(3);
    expect(await Transcript.countDocuments({})).toBe(3);
    expect(await MeetingInsight.countDocuments({})).toBe(3);
  });

  it('keeps "Friday" a Friday when it moves the dates', async () => {
    const { seededTeam, people } = await seedPeople();
    const fixtures = await loadMeetingFixtures();

    await seedDemoMeetings({
      teamId: seededTeam._id.toString(),
      people,
      fixtures,
      now: new Date('2027-03-03T12:00:00Z'),
    });

    for (const fixture of fixtures) {
      const meeting = await Meeting.findOne({ seedKey: fixture.key });
      const original = new Date(fixture.meetingDate);
      expect(meeting?.startedAt?.getUTCDay()).toBe(original.getUTCDay());
      expect(meeting?.startedAt?.getTime()).toBeLessThan(new Date('2027-03-03').getTime());
    }
  });

  it('survives the cleanup, even when asked to sweep everything', async () => {
    const { seededTeam, people } = await seedPeople();
    await seedDemoMeetings({ teamId: seededTeam._id.toString(), people });

    const result = await cleanupDemoData({ olderThanHours: 0 });

    expect(result.meetings).toBe(0);
    expect(await Meeting.countDocuments({ seeded: true })).toBe(3);
    expect(await Transcript.countDocuments({})).toBe(3);
    expect(await MeetingInsight.countDocuments({})).toBe(3);
  });

  it('still sweeps an ordinary stale meeting, taking its AI output with it', async () => {
    const { demo, seededTeam, people } = await seedPeople();
    await seedDemoMeetings({ teamId: seededTeam._id.toString(), people });

    const stale = await createMeeting(seededTeam._id, demo._id, 'STALE234', 10);
    await Transcript.create({ meetingId: stale._id, text: 'x', provider: 'mock' });
    await MeetingInsight.create({ meetingId: stale._id, summary: 'x', provider: 'mock' });

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.meetings).toBe(1);
    expect(await Meeting.exists({ _id: stale._id })).toBeNull();
    expect(await Transcript.countDocuments({ meetingId: stale._id })).toBe(0);
    expect(await MeetingInsight.countDocuments({ meetingId: stale._id })).toBe(0);
    expect(await Meeting.countDocuments({ seeded: true })).toBe(3);
  });
});

describe('sample meeting fixtures', () => {
  it('are all valid, with owners who are listed as participants', async () => {
    const fixtures = await loadMeetingFixtures();

    expect(fixtures.length).toBeGreaterThanOrEqual(2);
    for (const fixture of fixtures) {
      for (const item of fixture.reference.actionItems) {
        if (item.assigneeName) expect(fixture.participants).toContain(item.assigneeName);
      }
      for (const segment of fixture.segments) {
        if (segment.speaker) expect(fixture.participants).toContain(segment.speaker);
      }
    }
  });

  it('shift by whole weeks only', () => {
    const monday = new Date('2026-09-14T09:30:00Z');
    const weeks = weeksToShift(monday, new Date('2026-12-02T12:00:00Z'), 1);
    const shifted = new Date(monday.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    expect(shifted.getUTCDay()).toBe(1);
    expect(shifted.getTime()).toBeLessThanOrEqual(new Date('2026-12-01T12:00:00Z').getTime());
  });
});
