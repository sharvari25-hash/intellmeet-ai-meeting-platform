import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Message } from '../chat/message.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { cleanupDemoData, startDemoCleanup, stopDemoCleanup } from './demo.cleanup.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

/** The shared demo account, plus a real account that must never be swept. */
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
    // button: reviewers share one account and one of them is always mid-call.
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

    expect(result).toEqual({ meetings: 0, messages: 0, teams: 0, notifications: 0 });
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
      meetings: 0,
      messages: 0,
      teams: 0,
      notifications: 0,
    });
  });

  it('sweeps everything but the seed when asked for an age of zero', async () => {
    const { demo, seededTeam } = await seedAccounts();
    await createMeeting(seededTeam._id, demo._id, 'RIGHTNW', 0);

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
    // finished. `stopDemoCleanup` is therefore also a no-op here.
    expect(() => {
      startDemoCleanup();
      stopDemoCleanup();
    }).not.toThrow();
  });
});
