import { describe, expect, it } from 'vitest';
import type { Types } from 'mongoose';
import { Message } from '../chat/message.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { cleanupDemoData, removeGuests } from './demo.cleanup.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';
import { GUEST_ANIMALS, GUEST_COLOURS, createDemoGuest, pickGuestName } from './demo.guests.js';

const HOUR = 60 * 60 * 1000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

/** Always takes the first candidate, so a test can predict the name. */
const first = () => 0;

describe('pickGuestName', () => {
  it('makes a two-word name from a colour and an animal', () => {
    expect(pickGuestName([], first)).toBe(`${GUEST_COLOURS[0]} ${GUEST_ANIMALS[0]}`);
  });

  it('avoids any word already used by someone in the team', () => {
    const taken = [`${GUEST_COLOURS[0]} Lovelace`, `Grace ${GUEST_ANIMALS[0]}`];

    const name = pickGuestName(taken, first);

    // "Amber" and "Badger" are both in use, so neither may be reused: a spoken
    // "Amber" would otherwise match two people and be assigned to nobody.
    expect(name).toBe(`${GUEST_COLOURS[1]} ${GUEST_ANIMALS[1]}`);
  });

  it('numbers a repeat only once every word has been used', () => {
    const everyone = GUEST_COLOURS.map((colour, i) => `${colour} ${GUEST_ANIMALS[i]}`);

    const name = pickGuestName(everyone, first);

    expect(name).toBe(`${GUEST_COLOURS[0]} ${GUEST_ANIMALS[0]} 2`);
  });
});

describe('createDemoGuest', () => {
  it('refuses when the demo team has not been seeded', async () => {
    await expect(createDemoGuest()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await User.countDocuments({})).toBe(0);
  });
});

// --- The sweep ------------------------------------------------------------

async function seedTeam() {
  const persona = await User.create({
    name: 'Demo User',
    email: 'demo@intellmeet.app',
    passwordHash: 'x',
    authProvider: 'demo',
  });
  const team = await Team.create({
    name: 'IntellMeet Demo Team',
    slug: DEMO_TEAM_SLUG,
    ownerId: persona._id,
    members: [{ userId: persona._id, role: 'admin', joinedAt: new Date() }],
  });
  return { persona, team };
}

/**
 * A guest as the demo login leaves it: in the seeded team, with a refresh
 * token per sign-in or refresh. Ages are hours before now.
 */
async function guest(
  teamId: Types.ObjectId,
  options: { createdHoursAgo: number; lastActiveHoursAgo: number | null; name?: string },
) {
  const user = await User.create({
    name: options.name ?? 'Amber Otter',
    email: `guest-${Math.random().toString(16).slice(2)}@guest.intellmeet.invalid`,
    authProvider: 'guest',
    refreshTokens:
      options.lastActiveHoursAgo === null
        ? []
        : [
            {
              hash: Math.random().toString(16),
              familyId: 'f',
              expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
              createdAt: ago(options.lastActiveHoursAgo),
            },
          ],
  });
  await User.collection.updateOne(
    { _id: user._id },
    { $set: { createdAt: ago(options.createdHoursAgo) } },
  );
  await Team.updateOne(
    { _id: teamId },
    { $push: { members: { userId: user._id, role: 'member', joinedAt: new Date() } } },
  );
  return user;
}

async function meeting(teamId: Types.ObjectId, hostId: Types.ObjectId, roomCode: string) {
  return Meeting.create({ teamId, title: roomCode, hostId, roomCode, status: 'live' });
}

describe('demo cleanup of guest accounts', () => {
  it('removes an idle guest with everything only it could manage', async () => {
    const { team } = await seedTeam();
    const idle = await guest(team._id, { createdHoursAgo: 10, lastActiveHoursAgo: 9 });

    // Recent, but hosted by a guest nobody can ever sign in as again: it
    // could never be ended or deleted, so it goes regardless of age.
    const hosted = await meeting(team._id, idle._id, 'GUEST23');
    await Message.create({ meetingId: hosted._id, senderId: idle._id, text: 'hello' });

    const ownTeam = await Team.create({
      name: 'Scratch',
      slug: 'scratch',
      ownerId: idle._id,
      members: [{ userId: idle._id, role: 'admin', joinedAt: new Date() }],
    });
    await Notification.create({
      userId: idle._id,
      type: 'meeting_started',
      title: 'Meeting started',
      body: 'x',
    });

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result).toMatchObject({ guests: 1, meetings: 1, messages: 1, teams: 1 });
    expect(await User.exists({ _id: idle._id })).toBeNull();
    expect(await Meeting.exists({ _id: hosted._id })).toBeNull();
    expect(await Team.exists({ _id: ownTeam._id })).toBeNull();
    expect(await Notification.countDocuments({ userId: idle._id })).toBe(0);

    // Out of the seeded team's member list, which is otherwise untouched.
    const seeded = await Team.findOne({ slug: DEMO_TEAM_SLUG });
    expect(seeded?.members.map((m) => m.userId.toString())).not.toContain(idle._id.toString());
    expect(seeded?.members).toHaveLength(1);
  });

  it('keeps a guest who signed up long ago but is still active', async () => {
    const { team } = await seedTeam();
    // A reviewer still clicking around after the TTL: the refresh an hour ago
    // is what proves it.
    const active = await guest(team._id, { createdHoursAgo: 10, lastActiveHoursAgo: 1 });

    const result = await cleanupDemoData({ olderThanHours: 6 });

    expect(result.guests).toBe(0);
    expect(await User.exists({ _id: active._id })).not.toBeNull();
  });

  it('keeps a brand-new guest, and removes an old one that signed out', async () => {
    const { team } = await seedTeam();
    const fresh = await guest(team._id, { createdHoursAgo: 0, lastActiveHoursAgo: null });
    const signedOut = await guest(team._id, { createdHoursAgo: 8, lastActiveHoursAgo: null });

    await cleanupDemoData({ olderThanHours: 6 });

    expect(await User.exists({ _id: fresh._id })).not.toBeNull();
    expect(await User.exists({ _id: signedOut._id })).toBeNull();
  });

  it('leaves meetings the guest only attended with their host', async () => {
    const { persona, team } = await seedTeam();
    const idle = await guest(team._id, { createdHoursAgo: 10, lastActiveHoursAgo: 9 });

    const theirs = await meeting(team._id, persona._id, 'HOSTED2');
    await Meeting.updateOne(
      { _id: theirs._id },
      { $push: { participants: { userId: idle._id, joinedAt: new Date() } } },
    );

    await cleanupDemoData({ olderThanHours: 6 });

    expect(await Meeting.exists({ _id: theirs._id })).not.toBeNull();
  });

  it('never deletes the seeded persona or a real account, even at age zero', async () => {
    const { persona } = await seedTeam();
    const real = await User.create({
      name: 'Ada Lovelace',
      email: 'ada@intellmeet.app',
      passwordHash: 'x',
      authProvider: 'local',
    });

    // Handed their ids directly: the provider check inside is the guarantee.
    const direct = await removeGuests([persona._id, real._id]);
    const swept = await cleanupDemoData({ olderThanHours: 0 });

    expect(direct.guests).toBe(0);
    expect(swept.guests).toBe(0);
    expect(await User.countDocuments({})).toBe(2);
    expect(await Team.findOne({ slug: DEMO_TEAM_SLUG })).not.toBeNull();
  });
});
