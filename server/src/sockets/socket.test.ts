import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Socket as ClientSocket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@intellmeet/shared';
import { createApp } from '../app.js';
import { Message } from '../modules/chat/message.model.js';
import { Meeting } from '../modules/meetings/meeting.model.js';
import { bearer, createInvite, createTeam, registerUser, type TestUser } from '../test/fixtures.js';
import {
  closeClients,
  connectClient,
  startSocketServer,
  waitFor,
  type SocketHarness,
} from '../test/socketHarness.js';

const app = createApp();

let harness: SocketHarness;
const openClients: ClientSocket[] = [];

beforeEach(async () => {
  harness = await startSocketServer();
});

afterEach(async () => {
  await closeClients(...openClients.splice(0));
  await harness.close();
});

/** Connects a client and registers it for teardown. */
async function client(user: TestUser): Promise<ClientSocket> {
  const socket = await connectClient(harness.url, user.accessToken);
  openClients.push(socket);
  return socket;
}

/** Host and member in the same team, with a live meeting. */
async function liveMeeting(): Promise<{
  host: TestUser;
  member: TestUser;
  meetingId: string;
  teamId: string;
}> {
  const host = await registerUser(app);
  const member = await registerUser(app);
  const teamId = await createTeam(app, host);
  const code = await createInvite(app, host, teamId);

  await request(app)
    .post('/api/teams/join')
    .set('Authorization', bearer(member))
    .send({ code })
    .expect(200);

  const response = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Standup' })
    .expect(201);

  return { host, member, teamId, meetingId: response.body.meeting.id as string };
}

describe('handshake authentication', () => {
  it('accepts a valid access token', async () => {
    const user = await registerUser(app);
    const socket = await client(user);
    expect(socket.connected).toBe(true);
  });

  it('rejects a connection with no token', async () => {
    await expect(connectClient(harness.url, '')).rejects.toThrow();
  });

  it('rejects an invalid token', async () => {
    await expect(connectClient(harness.url, 'not.a.jwt')).rejects.toThrow();
  });
});

describe('two clients in a meeting room', () => {
  it('shows the second joiner who is already present, and tells the first', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    // The host joins first and sees only itself.
    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    const hostView = await waitFor<{
      participants: { userId: string; isHost: boolean }[];
      selfSocketId: string;
    }>(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    expect(hostView.participants).toHaveLength(1);
    expect(hostView.participants[0]?.isHost).toBe(true);
    expect(hostView.selfSocketId).toBe(hostSocket.id);

    // The member joins: it receives the roster, and the host is told separately.
    const hostNotified = waitFor<{ participant: { userId: string } }>(
      hostSocket,
      SOCKET_EVENTS.ROOM_USER_JOINED,
    );

    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    const memberView = await waitFor<{ participants: { userId: string }[] }>(
      memberSocket,
      SOCKET_EVENTS.ROOM_PARTICIPANTS,
    );

    expect(memberView.participants).toHaveLength(2);

    const joined = await hostNotified;
    expect(joined.participant.userId).toBe(member.id);
  });

  it('records attendance on the meeting document', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const meeting = await Meeting.findById(meetingId);
    expect(meeting?.participants).toHaveLength(2);
    // Still in the room, so nobody has left yet.
    expect(meeting?.participants.every((p) => p.leftAt === null)).toBe(true);
  });

  it('announces a leave to the others', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const hostSawLeave = waitFor<{ userId: string }>(hostSocket, SOCKET_EVENTS.ROOM_USER_LEFT);
    memberSocket.emit(SOCKET_EVENTS.ROOM_LEAVE, { meetingId });

    expect((await hostSawLeave).userId).toBe(member.id);

    const meeting = await Meeting.findById(meetingId);
    const record = meeting?.participants.find((p) => p.userId.toString() === member.id);
    expect(record?.leftAt).not.toBeNull();
  });

  it('cleans up when a client disconnects without leaving', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const hostSawLeave = waitFor<{ userId: string }>(hostSocket, SOCKET_EVENTS.ROOM_USER_LEFT);

    // A closed tab never sends room:leave - the disconnect handler has to.
    memberSocket.disconnect();

    expect((await hostSawLeave).userId).toBe(member.id);
  });

  it('refuses to let a non-member join', async () => {
    const { meetingId } = await liveMeeting();
    const stranger = await registerUser(app);
    const strangerSocket = await client(stranger);

    // The handshake only proves identity; room access is re-checked on join.
    const error = waitFor<{ code: string }>(strangerSocket, SOCKET_EVENTS.ERROR);
    strangerSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });

    expect((await error).code).toBe('NOT_FOUND');
  });

  it('rejects a malformed payload without dropping the connection', async () => {
    const { host } = await liveMeeting();
    const hostSocket = await client(host);

    const error = waitFor<{ code: string }>(hostSocket, SOCKET_EVENTS.ERROR);
    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId: 'not-an-object-id' });

    expect((await error).code).toBe('VALIDATION_ERROR');
    expect(hostSocket.connected).toBe(true);
  });
});

describe('chat over the socket', () => {
  it('broadcasts a message to everyone in the room and persists it', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const memberReceives = waitFor<{ text: string; senderId: string; senderName: string }>(
      memberSocket,
      SOCKET_EVENTS.CHAT_MESSAGE,
    );
    // The sender gets it too, so its optimistic UI can reconcile against the
    // persisted row rather than guessing an id.
    const hostReceives = waitFor<{ text: string }>(hostSocket, SOCKET_EVENTS.CHAT_MESSAGE);

    hostSocket.emit(SOCKET_EVENTS.CHAT_SEND, { meetingId, text: 'Morning all' });

    const received = await memberReceives;
    expect(received.text).toBe('Morning all');
    expect(received.senderId).toBe(host.id);
    expect(received.senderName).toBe(host.name);
    expect((await hostReceives).text).toBe('Morning all');

    // Persisted before broadcast, so a refresh does not lose it.
    expect(await Message.countDocuments({ meetingId })).toBe(1);
  });

  it('relays typing indicators without persisting them', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const typing = waitFor<{ userId: string }>(memberSocket, SOCKET_EVENTS.CHAT_TYPING);
    hostSocket.emit(SOCKET_EVENTS.CHAT_TYPING, { meetingId });

    expect((await typing).userId).toBe(host.id);
    expect(await Message.countDocuments({ meetingId })).toBe(0);
  });

  it('rejects an empty message', async () => {
    const { host, meetingId } = await liveMeeting();
    const hostSocket = await client(host);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const error = waitFor<{ code: string }>(hostSocket, SOCKET_EVENTS.ERROR);
    hostSocket.emit(SOCKET_EVENTS.CHAT_SEND, { meetingId, text: '   ' });

    expect((await error).code).toBe('VALIDATION_ERROR');
  });

  it('throttles a socket that floods the room', async () => {
    const { host, meetingId } = await liveMeeting();
    const hostSocket = await client(host);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const error = waitFor<{ code: string }>(hostSocket, SOCKET_EVENTS.ERROR, 6_000);

    // Socket events never reach express-rate-limit, so the throttle lives on
    // the socket itself. 15 per 10s is the budget.
    for (let i = 0; i < 25; i += 1) {
      hostSocket.emit(SOCKET_EVENTS.CHAT_SEND, { meetingId, text: `spam ${i}` });
    }

    expect((await error).code).toBe('RATE_LIMITED');
  });
});

describe('WebRTC signalling relay', () => {
  it('forwards an offer to the targeted peer only', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    const hostView = await waitFor<{ selfSocketId: string }>(
      hostSocket,
      SOCKET_EVENTS.ROOM_PARTICIPANTS,
    );

    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    const memberView = await waitFor<{ selfSocketId: string }>(
      memberSocket,
      SOCKET_EVENTS.ROOM_PARTICIPANTS,
    );

    const offer = waitFor<{ from: string; fromUserId: string; payload: { sdp: string } }>(
      memberSocket,
      SOCKET_EVENTS.RTC_OFFER,
    );

    hostSocket.emit(SOCKET_EVENTS.RTC_OFFER, {
      target: memberView.selfSocketId,
      meetingId,
      payload: { type: 'offer', sdp: 'v=0 fake session description' },
    });

    const delivered = await offer;
    expect(delivered.from).toBe(hostView.selfSocketId);
    expect(delivered.fromUserId).toBe(host.id);
    // Relayed verbatim: the server never parses SDP.
    expect(delivered.payload.sdp).toBe('v=0 fake session description');
  });

  it('round-trips an answer and an ICE candidate', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    const hostView = await waitFor<{ selfSocketId: string }>(
      hostSocket,
      SOCKET_EVENTS.ROOM_PARTICIPANTS,
    );
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const answer = waitFor<{ payload: { type: string } }>(hostSocket, SOCKET_EVENTS.RTC_ANSWER);
    memberSocket.emit(SOCKET_EVENTS.RTC_ANSWER, {
      target: hostView.selfSocketId,
      meetingId,
      payload: { type: 'answer', sdp: 'v=0 answer' },
    });
    expect((await answer).payload.type).toBe('answer');

    const candidate = waitFor<{ payload: { candidate: string } }>(
      hostSocket,
      SOCKET_EVENTS.RTC_ICE_CANDIDATE,
    );
    memberSocket.emit(SOCKET_EVENTS.RTC_ICE_CANDIDATE, {
      target: hostView.selfSocketId,
      meetingId,
      payload: { candidate: 'candidate:1 1 udp 2130706431 192.0.2.1 54321 typ host' },
    });
    expect((await candidate).payload.candidate).toContain('typ host');
  });

  it('refuses to relay into a meeting the sender has not joined', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    const memberView = await waitFor<{ selfSocketId: string }>(
      memberSocket,
      SOCKET_EVENTS.ROOM_PARTICIPANTS,
    );

    // The host never joined the room, so it must not be able to inject
    // signalling into it.
    const error = waitFor<{ code: string }>(hostSocket, SOCKET_EVENTS.ERROR);
    hostSocket.emit(SOCKET_EVENTS.RTC_OFFER, {
      target: memberView.selfSocketId,
      meetingId,
      payload: { sdp: 'nope' },
    });

    expect((await error).code).toBe('FORBIDDEN');
  });
});

describe('media state and host controls', () => {
  it('broadcasts a media toggle to the other participants', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const toggled = waitFor<{ state: { audio: boolean } }>(
      memberSocket,
      SOCKET_EVENTS.MEDIA_TOGGLE,
    );

    hostSocket.emit(SOCKET_EVENTS.MEDIA_TOGGLE, {
      meetingId,
      state: { audio: false, video: true, screen: false },
    });

    expect((await toggled).state.audio).toBe(false);
  });

  it('lets only the host end the meeting for everyone', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    // A member trying to end it is refused.
    const refused = waitFor<{ code: string }>(memberSocket, SOCKET_EVENTS.ERROR);
    memberSocket.emit(SOCKET_EVENTS.ROOM_END, { meetingId });
    expect((await refused).code).toBe('FORBIDDEN');

    // The host can, and everyone is told.
    const ended = waitFor<{ meetingId: string }>(memberSocket, SOCKET_EVENTS.ROOM_END);
    hostSocket.emit(SOCKET_EVENTS.ROOM_END, { meetingId });

    expect((await ended).meetingId).toBe(meetingId);
    expect((await Meeting.findById(meetingId))?.status).toBe('ended');
  });

  it('relays a host mute request to the room', async () => {
    const { host, member, meetingId } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);

    hostSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(hostSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);
    memberSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(memberSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    const muted = waitFor<{ targetUserId: string | null; byUserId: string }>(
      memberSocket,
      SOCKET_EVENTS.ROOM_HOST_MUTE,
    );

    hostSocket.emit(SOCKET_EVENTS.ROOM_HOST_MUTE, { meetingId, targetUserId: member.id });

    const request_ = await muted;
    expect(request_.targetUserId).toBe(member.id);
    expect(request_.byUserId).toBe(host.id);
  });
});

describe('presence', () => {
  it('announces a teammate coming online', async () => {
    const { host, member } = await liveMeeting();

    // The host connects first so it is listening when the member arrives.
    const hostSocket = await client(host);
    const online = waitFor<{ userId: string }>(hostSocket, SOCKET_EVENTS.PRESENCE_ONLINE);

    await client(member);

    expect((await online).userId).toBe(member.id);
  });

  it('announces a teammate going offline when their last socket closes', async () => {
    const { host, member } = await liveMeeting();

    const hostSocket = await client(host);
    const memberSocket = await client(member);
    await waitFor(hostSocket, SOCKET_EVENTS.PRESENCE_ONLINE);

    const offline = waitFor<{ userId: string }>(hostSocket, SOCKET_EVENTS.PRESENCE_OFFLINE);
    memberSocket.disconnect();

    expect((await offline).userId).toBe(member.id);
  });
});
