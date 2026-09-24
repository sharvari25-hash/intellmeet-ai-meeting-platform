import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { meetingIntelligenceSchema, type ActionItem } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import {
  bearer,
  createInvite,
  createTeam,
  registerUser,
  type TestUser,
} from '../../test/fixtures.js';
import { Meeting } from '../meetings/meeting.model.js';
import { MeetingInsight } from './insight.model.js';

const app = createApp();

/**
 * An ended meeting with an AI summary: a host, a team-mate who attended, and
 * two action items - one owned by the team-mate, one by a name the AI heard
 * that matches nobody.
 */
async function summarisedMeeting() {
  const host = await registerUser(app, { name: 'Grace Hopper' });
  const mate = await registerUser(app, { name: 'Ada Lovelace' });
  const teamId = await createTeam(app, host);
  const code = await createInvite(app, host, teamId);
  await request(app).post('/api/teams/join').set('Authorization', bearer(mate)).send({ code });

  const created = await request(app)
    .post('/api/meetings')
    .set('Authorization', bearer(host))
    .send({ teamId, title: 'Sprint review' })
    .expect(201);
  const meetingId = created.body.meeting.id as string;
  await request(app).post(`/api/meetings/${meetingId}/end`).set('Authorization', bearer(host));
  await Meeting.updateOne({ _id: meetingId }, { $set: { aiStatus: 'done' } });

  const taskId = new Types.ObjectId();
  await MeetingInsight.create({
    meetingId,
    summary: 'The team reviewd the sprint.',
    keyDecisions: ['Ship on Friday'],
    actionItems: [
      {
        text: 'Write the release notes',
        assigneeName: 'Ada Lovelace',
        assigneeId: mate.id,
        dueDate: '2026-10-02',
        taskId,
      },
      { text: 'Call the vendor', assigneeName: 'Sam', assigneeId: null, dueDate: null },
    ],
    provider: 'mock',
  });

  return { host, mate, teamId, meetingId, taskId };
}

async function intelligence(user: TestUser, meetingId: string) {
  const response = await request(app)
    .get(`/api/meetings/${meetingId}/intelligence`)
    .set('Authorization', bearer(user))
    .expect(200);
  return meetingIntelligenceSchema.parse(response.body);
}

function edit(user: TestUser, meetingId: string, body: unknown) {
  return request(app)
    .patch(`/api/meetings/${meetingId}/insight`)
    .set('Authorization', bearer(user))
    .send(body as object);
}

/** An item as the edit form sends it back. */
const asInput = (item: ActionItem) => ({
  id: item.id,
  text: item.text,
  assigneeId: item.assigneeId,
  assigneeName: item.assigneeName,
  dueDate: item.dueDate,
  status: item.status,
});

describe('PATCH /api/meetings/:id/insight', () => {
  it('lets the host correct the summary and decisions, and marks the edit', async () => {
    const { host, mate, meetingId } = await summarisedMeeting();

    const response = await edit(host, meetingId, {
      summary: 'The team reviewed the sprint.',
      keyDecisions: ['Ship on Friday', 'Freeze scope on Wednesdays'],
    }).expect(200);

    // Answers with the whole payload, so the page needs no second request.
    const updated = meetingIntelligenceSchema.parse(response.body);
    expect(updated.insight?.summary).toBe('The team reviewed the sprint.');
    expect(updated.insight?.editedByName).toBe('Grace Hopper');

    // ...and everyone else sees it, no longer presented as purely AI output.
    const seen = await intelligence(mate, meetingId);
    expect(seen.insight?.keyDecisions).toEqual(['Ship on Friday', 'Freeze scope on Wednesdays']);
    expect(seen.insight?.editedAt).not.toBeNull();
    // Untouched fields stay as they were.
    expect(seen.insight?.actionItems).toHaveLength(2);
  });

  it('keeps an edited item’s identity and task link, and gives new items their own', async () => {
    const { host, mate, meetingId, taskId } = await summarisedMeeting();
    const before = (await intelligence(host, meetingId)).insight?.actionItems ?? [];
    const [notes, vendor] = before;
    if (!notes || !vendor) throw new Error('Expected two action items');

    const response = await edit(host, meetingId, {
      actionItems: [
        // Reordered, reworded and ticked off.
        { ...asInput(vendor), text: 'Call the vendor about pricing' },
        { ...asInput(notes), status: 'done' },
        {
          text: 'Book the retro',
          assigneeId: host.id,
          // Ignored: an owner's name always comes from their account.
          assigneeName: 'Somebody Else',
          dueDate: null,
          status: 'open',
        },
        // A made-up id must not adopt anybody's task.
        { ...asInput(notes), id: new Types.ObjectId().toString(), text: 'Duplicate' },
      ],
    }).expect(200);

    const items = meetingIntelligenceSchema.parse(response.body).insight?.actionItems ?? [];
    expect(items.map((item) => item.text)).toEqual([
      'Call the vendor about pricing',
      'Write the release notes',
      'Book the retro',
      'Duplicate',
    ]);

    expect(items[0]?.id).toBe(vendor.id);
    expect(items[0]?.assigneeName).toBe('Sam');
    expect(items[0]?.assigneeId).toBeNull();

    expect(items[1]).toMatchObject({
      id: notes.id,
      status: 'done',
      assigneeId: mate.id,
      taskId: taskId.toString(),
    });

    expect(items[2]).toMatchObject({ assigneeId: host.id, assigneeName: 'Grace Hopper' });
    expect([vendor.id, notes.id]).not.toContain(items[2]?.id);

    expect(items[3]?.taskId).toBeNull();
    expect(items[3]?.id).not.toBe(notes.id);
  });

  it('refuses an owner who is not in the meeting’s team', async () => {
    const { host, meetingId } = await summarisedMeeting();
    const stranger = await registerUser(app);

    const response = await edit(host, meetingId, {
      actionItems: [
        {
          text: 'Leak the roadmap',
          assigneeId: stranger.id,
          assigneeName: null,
          dueDate: null,
          status: 'open',
        },
      ],
    }).expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].path).toBe('body.actionItems.0.assigneeId');
  });

  it('is for the host alone', async () => {
    const { mate, meetingId } = await summarisedMeeting();
    const outsider = await registerUser(app);

    await edit(mate, meetingId, { summary: 'Rewritten by a guest' }).expect(403);
    // Not even the meeting's existence is confirmed to a non-member.
    await edit(outsider, meetingId, { summary: 'x' }).expect(404);
  });

  it('waits for the AI to finish, and needs a summary to exist', async () => {
    const { host, meetingId } = await summarisedMeeting();

    await Meeting.updateOne({ _id: meetingId }, { $set: { aiStatus: 'summarizing' } });
    const busy = await edit(host, meetingId, { summary: 'Too early' }).expect(409);
    expect(busy.body.error.message).toMatch(/still being generated/);

    await Meeting.updateOne({ _id: meetingId }, { $set: { aiStatus: 'done' } });
    await MeetingInsight.deleteMany({ meetingId });
    await edit(host, meetingId, { summary: 'Nothing to edit' }).expect(404);
  });

  it('validates what it is sent', async () => {
    const { host, meetingId } = await summarisedMeeting();

    await edit(host, meetingId, {}).expect(400);
    await edit(host, meetingId, { summary: '   ' }).expect(400);
    await edit(host, meetingId, {
      actionItems: [
        { text: 'x', assigneeId: null, assigneeName: null, dueDate: '2026-02-30', status: 'open' },
      ],
    }).expect(400);
  });
});

describe('action items stored before they had ids', () => {
  it('get stable ids until the first edit gives them real ones', async () => {
    const { host, meetingId } = await summarisedMeeting();
    // Written the way Phase 6 wrote them: no _id on the items.
    await MeetingInsight.collection.updateOne(
      { meetingId: new Types.ObjectId(meetingId) },
      {
        $set: {
          actionItems: [{ text: 'Legacy item', assigneeName: null, assigneeId: null }],
        },
      },
    );

    const first = await intelligence(host, meetingId);
    const second = await intelligence(host, meetingId);
    expect(first.insight?.actionItems[0]?.id).toBe('legacy-0');
    expect(second.insight?.actionItems[0]?.id).toBe('legacy-0');

    const legacy = first.insight?.actionItems[0];
    if (!legacy) throw new Error('Expected the legacy item');
    await edit(host, meetingId, { actionItems: [asInput(legacy)] }).expect(200);

    const after = await intelligence(host, meetingId);
    expect(after.insight?.actionItems[0]?.id).toMatch(/^[a-f0-9]{24}$/);
    expect((await intelligence(host, meetingId)).insight?.actionItems[0]?.id).toBe(
      after.insight?.actionItems[0]?.id,
    );
  });
});
