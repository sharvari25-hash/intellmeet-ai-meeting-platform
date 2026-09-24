import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import type { Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import {
  addParticipant,
  getParticipants,
  getRoomRecording,
  setRoomRecording,
  type StoredParticipant,
} from '../../sockets/presence.js';
import type { AppServer } from '../../sockets/socket.types.js';
import {
  bearer,
  createInvite,
  createTeam,
  registerUser,
  type TestUser,
} from '../../test/fixtures.js';
import {
  closeClients,
  connectClient,
  startSocketServer,
  waitFor,
  type SocketHarness,
} from '../../test/socketHarness.js';
import { User } from '../users/user.model.js';
import { Meeting } from './meeting.model.js';
import { recordParticipantJoin } from './meeting.service.js';
import { endAbandonedMeetings } from './meeting.sweep.js';

const app = createApp();
const MINUTE = 60 * 1000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE);

let harness: SocketHarness;
const openClients: ClientSocket[] = [];

beforeEach(async () => {
  harness = await startSocketServer();
});

afterEach(async () => {
  await closeClients(...openClients.splice(0));
  await harness.close();
});

async function client(user: TestUser): Promise<ClientSocket> {
  const socket = await connectClient(harness.url, user.accessToken);
  openClients.push(socket);
  return socket;
}

/** A host and a team-mate, and a meeting the host started ("start now"). */
async function liveMeeting() {
  const host = await registerUser(app, { name: 'Ada Lovelace' });
  const member = await registerUser(app, { name: 'Grace Hopper' });
  const teamId = await createTeam(app, host);
  const code = await createInvite(app, host, teamId);
  await request(app).post('/api/teams/join').set('Authorization', bearer(member)).send({ code });

  const response = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Standup' })
    .expect(201);

  return { host, member, teamId, meetingId: response.body.meeting.id as string };
}

/** A roster entry for a socket that no longer exists, as a restart leaves behind. */
function ghost(userId: string, socketId = 'ghost-socket-1'): StoredParticipant {
  return {
    socketId,
    userId,
    name: 'Grace Hopper',
    avatarUrl: null,
    isHost: false,
    media: { audio: true, video: true, screen: false },
    joinedAt: new Date().toISOString(),
  };
}

async function setLastActive(meetingId: string, when: Date | null) {
  await Meeting.collection.updateOne(
    { _id: new Types.ObjectId(meetingId) },
    { $set: { lastActiveAt: when } },
  );
}

async function joinRoom(socket: ClientSocket, meetingId: string) {
  socket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
  return waitFor<{ participants: StoredParticipant[] }>(socket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
}

describe('ending live meetings everybody has left', () => {
  it('ends one nobody has been in for the idle limit, dated to when it emptied', async () => {
    const { host, member, meetingId } = await liveMeeting();
    // Two people were in it when the server died: nobody ever "left".
    await recordParticipantJoin(meetingId, host.id);
    await recordParticipantJoin(meetingId, member.id);
    const emptiedAt = ago(11);
    await setLastActive(meetingId, emptiedAt);
    await addParticipant(meetingId, ghost(member.id));

    // Warm the cache, so the test also proves the sweep evicts it.
    await request(app).get(`/api/meetings/${meetingId}`).set('Authorization', bearer(host));

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result).toMatchObject({ checked: 1, ended: 1 });
    const meeting = await Meeting.findById(meetingId);
    expect(meeting?.status).toBe('ended');
    // Its duration is how long it ran, not how long it went unnoticed.
    expect(meeting?.endedAt?.getTime()).toBe(emptiedAt.getTime());
    expect(meeting?.participants.map((p) => p.leftAt?.getTime())).toEqual([
      emptiedAt.getTime(),
      emptiedAt.getTime(),
    ]);
    expect(await getParticipants(meetingId)).toEqual([]);

    const fresh = await request(app)
      .get(`/api/meetings/${meetingId}`)
      .set('Authorization', bearer(host));
    expect(fresh.body.meeting.status).toBe('ended');
    expect(fresh.body.meeting.durationSec).not.toBeNull();
  });

  it('ends it whoever the host is, including the seeded demo persona', async () => {
    // The meeting from the bug report: hosted by an account the demo cleanup
    // never removes, so nothing ever ended or deleted it.
    const { teamId } = await liveMeeting();
    const persona = await User.create({
      name: 'Demo User',
      email: 'demo@intellmeet.app',
      authProvider: 'demo',
    });
    const stale = await Meeting.create({
      teamId,
      hostId: persona._id,
      title: 'Left live overnight',
      roomCode: 'LIVE234',
      status: 'live',
      startedAt: ago(10 * 60),
      lastActiveAt: ago(10 * 60),
    });

    await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect((await Meeting.findById(stale._id))?.status).toBe('ended');
  });

  it('ends one that was started but never joined', async () => {
    const { meetingId } = await liveMeeting();
    await Meeting.updateOne({ _id: meetingId }, { startedAt: ago(12) });

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result.ended).toBe(1);
    const meeting = await Meeting.findById(meetingId);
    expect(meeting?.endedAt?.getTime()).toBe(meeting?.startedAt?.getTime());
  });

  it('gives a room that has just emptied time before ending it', async () => {
    const { meetingId } = await liveMeeting();
    await setLastActive(meetingId, ago(3));

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result.ended).toBe(0);
    expect((await Meeting.findById(meetingId))?.status).toBe('live');
  });

  it('keeps a call that was running when the server restarted, while people reconnect', async () => {
    const { member, meetingId } = await liveMeeting();
    // The restart: the roster still lists everyone, no socket is connected,
    // and the room was last seen occupied by the sweep a couple of minutes ago.
    await addParticipant(meetingId, ghost(member.id));
    await setLastActive(meetingId, ago(2));

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result.ended).toBe(0);
    expect((await Meeting.findById(meetingId))?.status).toBe('live');
  });

  it('leaves an occupied meeting alone, however old, and keeps its clock fresh', async () => {
    const { host, meetingId } = await liveMeeting();
    const hostSocket = await client(host);
    await joinRoom(hostSocket, meetingId);
    await setLastActive(meetingId, ago(90));

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result.ended).toBe(0);
    const meeting = await Meeting.findById(meetingId);
    expect(meeting?.status).toBe('live');
    // Refreshed, so a restart straight after this would not make it look abandoned.
    expect(meeting?.lastActiveAt?.getTime()).toBeGreaterThan(ago(1).getTime());
  });

  it('never ends a meeting when it cannot tell who is connected', async () => {
    const { meetingId } = await liveMeeting();
    await setLastActive(meetingId, ago(60));

    // Another instance not answering: "unknown" must not be read as "empty".
    const unreachable = {
      in: () => ({
        fetchSockets: () => Promise.reject(new Error('timeout reached while waiting for replies')),
      }),
    } as unknown as AppServer;

    const result = await endAbandonedMeetings({ io: unreachable, idleMinutes: 10 });

    expect(result).toMatchObject({ checked: 1, ended: 0 });
    expect((await Meeting.findById(meetingId))?.status).toBe('live');
  });

  it('does nothing without a socket server to ask', async () => {
    const { meetingId } = await liveMeeting();
    await setLastActive(meetingId, ago(60));
    await harness.close();

    const result = await endAbandonedMeetings({ idleMinutes: 10 });

    expect(result.checked).toBe(0);
    expect((await Meeting.findById(meetingId))?.status).toBe('live');
    harness = await startSocketServer();
  });

  it('leaves scheduled and ended meetings alone', async () => {
    const { host, teamId } = await liveMeeting();
    await Meeting.deleteMany({});
    const scheduled = await Meeting.create({
      teamId,
      hostId: host.id,
      title: 'Next week',
      roomCode: 'SCHED23',
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 7 * 24 * 60 * MINUTE),
    });
    await Meeting.collection.updateOne({ _id: scheduled._id }, { $set: { createdAt: ago(600) } });

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result.checked).toBe(0);
    expect((await Meeting.findById(scheduled._id))?.status).toBe('scheduled');
  });
});

describe('the idle clock', () => {
  it('is stamped when somebody joins and when they leave', async () => {
    const { host, meetingId } = await liveMeeting();
    await setLastActive(meetingId, null);
    const hostSocket = await client(host);

    await joinRoom(hostSocket, meetingId);
    const joined = (await Meeting.findById(meetingId))?.lastActiveAt;
    expect(joined).toBeInstanceOf(Date);

    await new Promise((resolve) => setTimeout(resolve, 5));
    hostSocket.emit(SOCKET_EVENTS.ROOM_LEAVE, { meetingId });
    await expect
      .poll(async () => (await Meeting.findById(meetingId))?.lastActiveAt?.getTime())
      .toBeGreaterThan(joined?.getTime() ?? 0);
  });
});

describe('roster entries left behind by dead sockets', () => {
  it('are dropped before a newcomer is told who is here', async () => {
    const { host, member, meetingId } = await liveMeeting();
    await recordParticipantJoin(meetingId, member.id);
    await addParticipant(meetingId, ghost(member.id));

    const hostSocket = await client(host);
    const roster = await joinRoom(hostSocket, meetingId);

    // Only the live socket: offering to the ghost would hang on "Connecting…".
    expect(roster.participants.map((p) => p.userId)).toEqual([host.id]);
    expect((await getParticipants(meetingId)).map((p) => p.socketId)).toEqual([hostSocket.id]);

    // Grace's only entry was a ghost, so her attendance is closed.
    const meeting = await Meeting.findById(meetingId);
    const grace = meeting?.participants.find((p) => p.userId.toString() === member.id);
    expect(grace?.leftAt).toBeInstanceOf(Date);
  });

  it('are announced as having left, and a dead recorder stops the indicator', async () => {
    const { host, member, meetingId } = await liveMeeting();
    const hostSocket = await client(host);
    await joinRoom(hostSocket, meetingId);

    // The recording host's old socket died in a restart.
    await addParticipant(meetingId, ghost(member.id, 'dead-recorder'));
    await setRoomRecording(meetingId, { socketId: 'dead-recorder', userId: member.id });

    const left = waitFor<{ socketId: string }>(hostSocket, SOCKET_EVENTS.ROOM_USER_LEFT);
    const stopped = waitFor<{ recording: boolean }>(hostSocket, SOCKET_EVENTS.RECORDING_STATE);

    const memberSocket = await client(member);
    await joinRoom(memberSocket, meetingId);

    expect((await left).socketId).toBe('dead-recorder');
    expect((await stopped).recording).toBe(false);
    expect(await getRoomRecording(meetingId)).toBeNull();
  });

  it('are swept from rooms that stay occupied', async () => {
    const { host, member, meetingId } = await liveMeeting();
    const hostSocket = await client(host);
    await joinRoom(hostSocket, meetingId);
    await addParticipant(meetingId, ghost(member.id));

    const result = await endAbandonedMeetings({ io: harness.io, idleMinutes: 10 });

    expect(result).toMatchObject({ ended: 0, pruned: 1 });
    expect((await getParticipants(meetingId)).map((p) => p.socketId)).toEqual([hostSocket.id]);
  });
});
