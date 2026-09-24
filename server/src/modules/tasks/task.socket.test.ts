import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Socket as ClientSocket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type Notification,
  type TaskCommentedEvent,
  type TaskDeletedEvent,
  type TaskEvent,
  type TaskMoved,
} from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { addTask, defaultBoard, teamWithMember } from '../../test/boards.js';
import { bearer, type TestUser } from '../../test/fixtures.js';
import {
  closeClients,
  connectClient,
  startSocketServer,
  waitFor,
  type SocketHarness,
} from '../../test/socketHarness.js';

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

async function client(user: TestUser): Promise<ClientSocket> {
  const socket = await connectClient(harness.url, user.accessToken);
  openClients.push(socket);
  return socket;
}

/** Joins a board room; resolves once the server has processed the join. */
async function watchBoard(socket: ClientSocket, boardId: string): Promise<void> {
  socket.emit(SOCKET_EVENTS.BOARD_JOIN, { boardId });
  // Joins are acknowledged by nothing; a round trip through the server
  // (a join is handled before anything emitted after it) is enough.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/** Resolves if `event` does NOT arrive within the window. */
function nothingWithin(socket: ClientSocket, event: string, ms = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const onEvent = () => resolve(false);
    socket.once(event, onEvent);
    setTimeout(() => {
      socket.off(event, onEvent);
      resolve(true);
    }, ms);
  });
}

describe('a board in two browsers', () => {
  it('shows a task created in one window in the other, live', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const window2 = await client(member);
    await watchBoard(window2, board.id);

    const arrived = waitFor<TaskEvent>(window2, SOCKET_EVENTS.TASK_CREATED);
    const task = await addTask(app, admin, board.id, { title: 'Book the venue' });

    expect((await arrived).task).toMatchObject({
      id: task.id,
      title: 'Book the venue',
      version: 1,
    });
  });

  it('streams moves, edits, comments and deletes', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const task = await addTask(app, admin, board.id, { title: 'Book the venue' });
    const window2 = await client(member);
    await watchBoard(window2, board.id);

    const moved = waitFor<TaskMoved>(window2, SOCKET_EVENTS.TASK_MOVED);
    await request(app)
      .post(`/api/tasks/${task.id}/move`)
      .set('Authorization', bearer(admin))
      .send({ columnId: board.columns[1]?.id })
      .expect(200);
    expect((await moved).task).toMatchObject({
      id: task.id,
      columnId: board.columns[1]?.id,
      version: 2,
    });

    const updated = waitFor<TaskEvent>(window2, SOCKET_EVENTS.TASK_UPDATED);
    await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', bearer(admin))
      .send({ priority: 'high' })
      .expect(200);
    expect((await updated).task).toMatchObject({ priority: 'high', version: 3 });

    const commented = waitFor<TaskCommentedEvent>(window2, SOCKET_EVENTS.TASK_COMMENTED);
    await request(app)
      .post(`/api/tasks/${task.id}/comments`)
      .set('Authorization', bearer(admin))
      .send({ text: 'Deposit paid' })
      .expect(201);
    expect(await commented).toMatchObject({
      taskId: task.id,
      commentCount: 1,
      comment: { text: 'Deposit paid', authorName: 'Ada Lovelace' },
    });

    const deleted = waitFor<TaskDeletedEvent>(window2, SOCKET_EVENTS.TASK_DELETED);
    await request(app)
      .delete(`/api/tasks/${task.id}`)
      .set('Authorization', bearer(admin))
      .expect(204);
    expect(await deleted).toEqual({ boardId: board.id, taskId: task.id });
  });

  it('asks viewers to reload when the columns change', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const window2 = await client(member);
    await watchBoard(window2, board.id);

    const refresh = waitFor<{ boardId: string }>(window2, SOCKET_EVENTS.BOARD_REFRESH);
    await request(app)
      .post(`/api/boards/${board.id}/columns`)
      .set('Authorization', bearer(admin))
      .send({ title: 'Blocked' })
      .expect(201);

    expect(await refresh).toEqual({ boardId: board.id });
  });

  it('stops sending updates once the viewer leaves the board', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const window2 = await client(member);
    await watchBoard(window2, board.id);

    window2.emit(SOCKET_EVENTS.BOARD_LEAVE, { boardId: board.id });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const quiet = nothingWithin(window2, SOCKET_EVENTS.TASK_CREATED);
    await addTask(app, admin, board.id);
    expect(await quiet).toBe(true);
  });

  it('never lets somebody outside the team watch a board', async () => {
    const { admin, outsider, teamId } = await teamWithMember(app);
    const { board } = await defaultBoard(app, admin, teamId);
    const stranger = await client(outsider);

    const refused = waitFor<{ event: string; code: string }>(stranger, SOCKET_EVENTS.ERROR);
    stranger.emit(SOCKET_EVENTS.BOARD_JOIN, { boardId: board.id });
    expect(await refused).toMatchObject({ event: SOCKET_EVENTS.BOARD_JOIN, code: 'NOT_FOUND' });

    const quiet = nothingWithin(stranger, SOCKET_EVENTS.TASK_CREATED);
    await addTask(app, admin, board.id);
    expect(await quiet).toBe(true);
  });
});

describe('@mentions in meeting chat', () => {
  it('notify the person mentioned, live, and nobody else', async () => {
    const { admin, member, teamId } = await teamWithMember(app);
    const meeting = await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(admin))
      .send({ teamId, title: 'Standup' })
      .expect(201);
    const meetingId = meeting.body.meeting.id as string;

    const adaSocket = await client(admin);
    const graceSocket = await client(member);
    graceSocket.emit(SOCKET_EVENTS.ROOM_JOIN, { meetingId });
    await waitFor(graceSocket, SOCKET_EVENTS.ROOM_PARTICIPANTS);

    // Ada is not even in the room: the bell is how she hears about it.
    const notified = waitFor<Notification>(adaSocket, SOCKET_EVENTS.NOTIFY_NEW);
    const graceQuiet = nothingWithin(graceSocket, SOCKET_EVENTS.NOTIFY_NEW, 500);
    graceSocket.emit(SOCKET_EVENTS.CHAT_SEND, {
      meetingId,
      text: '@Ada Lovelace the demo is at 3, can you join?',
    });

    expect(await notified).toMatchObject({
      type: 'mention',
      title: 'Grace Hopper mentioned you in “Standup”',
      body: '@Ada Lovelace the demo is at 3, can you join?',
      payload: { meetingId, teamId },
    });
    expect(await graceQuiet).toBe(true);
  });
});
