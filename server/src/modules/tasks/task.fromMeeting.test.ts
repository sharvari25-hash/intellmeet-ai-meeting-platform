import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { meetingIntelligenceSchema, type Task } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { defaultBoard, teamWithMember } from '../../test/boards.js';
import { bearer, type TestUser } from '../../test/fixtures.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Notification } from '../notifications/notification.model.js';
import { Task as TaskModel } from './task.model.js';

const app = createApp();

/**
 * An ended meeting of the team with three AI action items: one for the
 * member, one for the admin, and one for a name that matched nobody.
 */
async function meetingWithActionItems() {
  const team = await teamWithMember(app);
  const created = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(team.admin))
    .send({ teamId: team.teamId, title: 'Sprint 14 planning' })
    .expect(201);
  const meetingId = created.body.meeting.id as string;
  await Meeting.updateOne({ _id: meetingId }, { $set: { status: 'ended', aiStatus: 'done' } });

  await MeetingInsight.create({
    meetingId,
    summary: 'Planned the sprint.',
    provider: 'mock',
    actionItems: [
      {
        text: 'Fix the upload retry bug',
        assigneeName: 'Grace Hopper',
        assigneeId: team.member.id,
        dueDate: '2026-10-02',
      },
      {
        text: 'Write the calendar spike',
        assigneeName: 'Ada Lovelace',
        assigneeId: team.admin.id,
        dueDate: null,
      },
      { text: 'Call the vendor', assigneeName: 'Sam', assigneeId: null, dueDate: null },
    ],
  });

  const items = await itemsOf(team.member, meetingId);
  return { ...team, meetingId, items };
}

async function itemsOf(user: TestUser, meetingId: string) {
  const response = await request(app)
    .get(`/api/meetings/${meetingId}/intelligence`)
    .set('Authorization', bearer(user))
    .expect(200);
  return meetingIntelligenceSchema.parse(response.body).insight?.actionItems ?? [];
}

function createTasks(
  user: TestUser,
  meetingId: string,
  items: { actionItemId: string; assigneeId: string | null; dueDate: string | null }[],
  boardId?: string,
) {
  return request(app)
    .post(`/api/meetings/${meetingId}/tasks`)
    .set('Authorization', bearer(user))
    .send({ items, ...(boardId ? { boardId } : {}) });
}

describe('creating tasks from action items', () => {
  it('turns one item into a task on the team board, linked both ways', async () => {
    const { member, teamId, meetingId, items } = await meetingWithActionItems();
    const [upload] = items;
    if (!upload) throw new Error('Expected action items');

    // Any member may file the tasks, not only the host.
    const response = await createTasks(member, meetingId, [
      { actionItemId: upload.id, assigneeId: upload.assigneeId, dueDate: upload.dueDate },
    ]).expect(201);

    const task = response.body.tasks[0] as Task;
    const { board } = await defaultBoard(app, member, teamId);
    expect(task).toMatchObject({
      title: 'Fix the upload retry bug',
      boardId: board.id,
      columnId: board.columns[0]?.id,
      assigneeId: member.id,
      dueDate: '2026-10-02',
      source: { meetingId, meetingTitle: 'Sprint 14 planning', actionItemId: upload.id },
    });

    // The item now knows its task, and where it is on the board.
    const [linked, ...rest] = response.body.intelligence.insight.actionItems;
    expect(linked).toMatchObject({
      taskId: task.id,
      task: { id: task.id, boardId: board.id, columnTitle: 'To Do', isDone: false },
    });
    expect(rest.every((item: { taskId: string | null }) => item.taskId === null)).toBe(true);
  });

  it('turns several at once, in order, with the owners chosen in the dialog', async () => {
    const { admin, member, teamId, meetingId, items } = await meetingWithActionItems();

    const response = await createTasks(
      member,
      meetingId,
      items.map((item, index) => ({
        actionItemId: item.id,
        // The vendor call had no owner the AI could match; given to Ada here.
        assigneeId: index === 2 ? admin.id : item.assigneeId,
        dueDate: item.dueDate,
      })),
    ).expect(201);

    expect(response.body.tasks.map((task: Task) => task.title)).toEqual([
      'Fix the upload retry bug',
      'Write the calendar spike',
      'Call the vendor',
    ]);
    expect(response.body.tasks[2].assigneeName).toBe('Ada Lovelace');
    const orders = response.body.tasks.map((task: Task) => task.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);

    // Ada was given two by somebody else; Grace gave herself one.
    expect(await Notification.countDocuments({ type: 'task_assigned', userId: admin.id })).toBe(2);
    expect(await Notification.countDocuments({ type: 'task_assigned', userId: member.id })).toBe(0);

    const board = await defaultBoard(app, member, teamId);
    expect(board.tasks).toHaveLength(3);
  });

  it('never makes two tasks for one item, even from a double click', async () => {
    const { member, meetingId, items } = await meetingWithActionItems();
    const [upload] = items;
    const body = [{ actionItemId: upload?.id ?? '', assigneeId: null, dueDate: null }];
    // The unique (meeting, item) index is the guarantee under test.
    await TaskModel.init();

    const [first, second] = await Promise.all([
      createTasks(member, meetingId, body),
      createTasks(member, meetingId, body),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    const made = [...first.body.tasks, ...second.body.tasks];
    expect(made).toHaveLength(1);
    expect([...first.body.skipped, ...second.body.skipped]).toEqual([upload?.id]);
    expect(await TaskModel.countDocuments({})).toBe(1);

    // And again later: skipped, not duplicated.
    const again = await createTasks(member, meetingId, body).expect(201);
    expect(again.body).toMatchObject({ tasks: [], skipped: [upload?.id] });
  });

  it('offers the item again once its task is deleted', async () => {
    const { member, meetingId, items } = await meetingWithActionItems();
    const [upload] = items;
    const made = await createTasks(member, meetingId, [
      { actionItemId: upload?.id ?? '', assigneeId: null, dueDate: null },
    ]).expect(201);

    await request(app)
      .delete(`/api/tasks/${made.body.tasks[0].id}`)
      .set('Authorization', bearer(member))
      .expect(204);

    const [after] = await itemsOf(member, meetingId);
    expect(after).toMatchObject({ id: upload?.id, taskId: null, task: null });
  });

  it('keeps the task, unlinked, when the meeting is deleted', async () => {
    const { admin, member, meetingId, items } = await meetingWithActionItems();
    await createTasks(member, meetingId, [
      { actionItemId: items[0]?.id ?? '', assigneeId: null, dueDate: null },
    ]).expect(201);

    await request(app)
      .delete(`/api/meetings/${meetingId}`)
      .set('Authorization', bearer(admin))
      .expect(204);

    const [task] = await TaskModel.find({});
    expect(task?.sourceMeetingId).toBeNull();
    expect(task?.title).toBe('Fix the upload retry bug');
  });

  it('gives items stored before they had ids real ones, and links them', async () => {
    const { member, meetingId } = await meetingWithActionItems();
    // Phase 6 stored items without an _id.
    await MeetingInsight.collection.updateOne(
      { meetingId: new Types.ObjectId(meetingId) },
      { $unset: { 'actionItems.$[]._id': '' } },
    );
    const legacy = await itemsOf(member, meetingId);
    expect(legacy[1]?.id).toBe('legacy-1');

    const response = await createTasks(member, meetingId, [
      { actionItemId: 'legacy-1', assigneeId: null, dueDate: null },
    ]).expect(201);

    const items = response.body.intelligence.insight.actionItems;
    expect(items.every((item: { id: string }) => /^[0-9a-f]{24}$/.test(item.id))).toBe(true);
    expect(items[1].taskId).toBe(response.body.tasks[0].id);
    expect(response.body.tasks[0].source.actionItemId).toBe(items[1].id);
  });

  it('refuses owners outside the team, unknown items and other teams’ boards', async () => {
    const { member, outsider, meetingId, items } = await meetingWithActionItems();
    const other = await teamWithMember(app);
    const { board: otherBoard } = await defaultBoard(app, other.admin, other.teamId);

    const invalid = await createTasks(member, meetingId, [
      { actionItemId: items[0]?.id ?? '', assigneeId: outsider.id, dueDate: null },
      { actionItemId: new Types.ObjectId().toString(), assigneeId: null, dueDate: null },
    ]).expect(400);
    expect(invalid.body.error.details.map((issue: { path: string }) => issue.path)).toEqual([
      'body.items.0.assigneeId',
      'body.items.1.actionItemId',
    ]);

    // Not a member of that board's team either: not found.
    await createTasks(
      member,
      meetingId,
      [{ actionItemId: items[0]?.id ?? '', assigneeId: null, dueDate: null }],
      otherBoard.id,
    ).expect(404);
    expect(await TaskModel.countDocuments({})).toBe(0);
  });

  it('is for members of the meeting’s team, and waits for the AI to finish', async () => {
    const { member, outsider, meetingId, items } = await meetingWithActionItems();
    const body = [{ actionItemId: items[0]?.id ?? '', assigneeId: null, dueDate: null }];

    await createTasks(outsider, meetingId, body).expect(404);

    await Meeting.updateOne({ _id: meetingId }, { $set: { aiStatus: 'summarizing' } });
    const busy = await createTasks(member, meetingId, body).expect(409);
    expect(busy.body.error.message).toMatch(/still being generated/);
  });
});
