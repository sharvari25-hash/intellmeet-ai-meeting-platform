import { Types } from 'mongoose';
import { DEFAULT_COLUMNS, ORDER_STEP, type TaskPriority } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { stableObjectId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Board } from '../tasks/board.model.js';
import { TaskComment } from '../tasks/comment.model.js';
import { announceBoardRefresh } from '../tasks/task.events.js';
import { Task } from '../tasks/task.model.js';
import { User } from '../users/user.model.js';
import { DEMO_TEAMMATES } from './demo.constants.js';
import { sampleActionItemId, type SeedPerson } from './demo.meetings.js';

/**
 * The demo team's board: four columns and a handful of sample tasks, three of
 * them made from the sample meetings' action items, so a reviewer's first
 * look at the task page is a team at work rather than an empty board.
 *
 * Every reviewer shares it. What they may do there is the general rule
 * (`taskPermissions`): move anything, add and edit their own tasks, delete
 * only their own. The sample tasks can be moved but not edited or deleted
 * except by a team admin, and none of the reviewers is one. Moving is the
 * whole point of a board, so moves are allowed and undone later instead: once
 * the board has been quiet for `DEMO_BOARD_RESET_IDLE_MIN`, the samples go
 * back where the seed put them, without the comments left on them. Tasks
 * reviewers created stay until their guest account is removed.
 */

export const DEMO_BOARD_KEY = 'demo-board';
export const DEMO_BOARD_NAME = 'Product board';

/** Stable, so tasks keep pointing at the right column across re-seeds and resets. */
const columnId = (index: number) => stableObjectId(`${DEMO_BOARD_KEY}:column:${index}`);

interface SampleTask {
  key: string;
  /** Index into `DEFAULT_COLUMNS`. */
  column: number;
  title: string;
  description: string;
  /** A seeded person's name. */
  assignee: string | null;
  priority: TaskPriority;
  /**
   * Due date, in days from the seed (or reset); negative is already overdue.
   * Relative even for a task made from an action item: the sample meetings
   * are a week or two old, so their items' own deadlines have mostly passed,
   * and a board where everything is late would not look like a team at work.
   */
  dueInDays: number | null;
  /** The sample meeting (fixture key) and action item (index) it was made from. */
  from?: { meeting: string; item: number };
}

export const SAMPLE_TASKS: readonly SampleTask[] = [
  {
    key: 'calendar-staging',
    column: 0,
    title: 'Set up a staging OAuth client for the calendar spike',
    description:
      'The spike needs a Google Cloud project with test users. Ask IT for an internal consent screen so the refresh tokens do not expire every week.',
    assignee: 'Ada Lovelace',
    priority: 'high',
    dueInDays: 5,
  },
  {
    key: 'release-notes',
    column: 0,
    title: 'Write the release notes for 1.4',
    description: 'Lead with the summary page and the faster recording upload.',
    assignee: 'Demo User',
    priority: 'low',
    dueInDays: null,
  },
  {
    key: 'upload-retry',
    column: 1,
    title: 'Fix the recording upload retry bug and merge it',
    description:
      'Uploads that fail on a flaky connection are not retried. Agreed in sprint planning.',
    assignee: 'Grace Hopper',
    priority: 'high',
    dueInDays: 2,
    from: { meeting: 'sprint-14-planning', item: 0 },
  },
  {
    key: 'a11y-triage',
    column: 1,
    title: 'Triage the accessibility audit findings',
    description: 'Twelve findings from the audit. Label each one blocker, soon or later.',
    assignee: 'Alan Turing',
    priority: 'medium',
    // Overdue on purpose: the board highlights it.
    dueInDays: -2,
  },
  {
    key: 'tabbed-prototype',
    column: 2,
    title: 'Prototype the tabbed summary page layout',
    description: 'Summary, action items and transcript as tabs. From the design review.',
    assignee: 'Alan Turing',
    priority: 'medium',
    dueInDays: 1,
    from: { meeting: 'summary-page-design-review', item: 0 },
  },
  {
    key: 'launch-checklist',
    column: 3,
    title: 'Draft the launch checklist and share it for comments',
    description: 'Shared in #launch; comments folded in.',
    assignee: 'Grace Hopper',
    priority: 'medium',
    dueInDays: -3,
    from: { meeting: 'q3-launch-retro', item: 2 },
  },
];

function daysFrom(now: Date, days: number): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface SeedBoardResult {
  boardId: string;
  tasks: number;
}

/**
 * Creates the demo board, or puts it back exactly as the seed made it.
 *
 * Idempotent, like the rest of the seed: the board and each sample task are
 * upserted by a stable key, so running it again restores rather than
 * duplicates. That makes it the reset as well:
 *
 * - columns go back to the four defaults (renamed or added ones are undone,
 *   and anything in a column that no longer exists moves to "To Do");
 * - every sample task goes back to its column, position, text, owner and a
 *   due date relative to today (so the overdue one is still overdue), with
 *   no comments;
 * - tasks reviewers created are left alone.
 *
 * Must run after `seedDemoMeetings`: three samples link to its action items.
 * `people` is the seed's list, the Demo User persona first.
 */
export async function seedDemoBoard(options: {
  teamId: string | Types.ObjectId;
  people: SeedPerson[];
  now?: Date;
}): Promise<SeedBoardResult> {
  const now = options.now ?? new Date();
  const teamId = new Types.ObjectId(String(options.teamId));
  const persona = options.people[0];
  if (!persona) throw new Error('seedDemoBoard needs at least one person');
  const byName = (name: string | null) =>
    name ? options.people.find((person) => person.name === name) : undefined;

  const columns = DEFAULT_COLUMNS.map((column, index) => ({
    _id: columnId(index),
    title: column.title,
    isDone: column.isDone,
  }));

  // The team may already have a default board, made by a visit before the
  // seed ever ran. That one becomes the demo board, rather than a second
  // default the unique index would refuse.
  const existing =
    (await Board.findOne({ seedKey: DEMO_BOARD_KEY })) ??
    (await Board.findOne({ teamId, isDefault: true }));
  const fields = {
    teamId,
    name: DEMO_BOARD_NAME,
    columns,
    isDefault: true,
    seeded: true,
    seedKey: DEMO_BOARD_KEY,
    restoredAt: now,
  };
  const board = existing
    ? await existing.set(fields).save()
    : await Board.create({ ...fields, createdBy: new Types.ObjectId(persona.id) });

  // Anything left in a column that no longer exists joins the bottom of "To Do".
  const strays = await Task.find({
    boardId: board._id,
    seeded: { $ne: true },
    columnId: { $nin: columns.map((column) => column._id) },
  }).select('_id');
  const last = await Task.findOne({ boardId: board._id, columnId: columnId(0) })
    .sort({ order: -1 })
    .select('order');
  let bottom = (last?.order ?? SAMPLE_TASKS.length * ORDER_STEP) + ORDER_STEP;
  for (const stray of strays) {
    await Task.updateOne(
      { _id: stray._id },
      { $set: { columnId: columnId(0), order: bottom }, $inc: { version: 1 } },
    );
    bottom += ORDER_STEP;
  }

  for (const [index, sample] of SAMPLE_TASKS.entries()) {
    // Samples sit at the top of their columns, in the order listed.
    const position = SAMPLE_TASKS.slice(0, index).filter((s) => s.column === sample.column).length;
    const seedKey = `${DEMO_BOARD_KEY}:${sample.key}`;

    let source: { meetingId: Types.ObjectId; itemId: Types.ObjectId } | null = null;
    const dueDate = sample.dueInDays === null ? null : daysFrom(now, sample.dueInDays);

    if (sample.from) {
      const meeting = await Meeting.findOne({ seedKey: sample.from.meeting }).select('_id');
      const itemId = sampleActionItemId(sample.from.meeting, sample.from.item);
      const insight = meeting
        ? await MeetingInsight.findOne({ meetingId: meeting._id }).select('actionItems').lean()
        : null;
      const item = insight?.actionItems.find((entry) => entry._id?.equals(itemId));

      if (meeting && item) {
        source = { meetingId: meeting._id, itemId };
        // A reviewer may have made a task from this item before the sample
        // existed. The sample takes the link; theirs keeps its meeting.
        await Task.updateMany(
          { sourceMeetingId: meeting._id, sourceActionItemId: itemId, seedKey: { $ne: seedKey } },
          { $set: { sourceActionItemId: null }, $inc: { version: 1 } },
        );
      }
    }

    const assignee = byName(sample.assignee);
    const task = await Task.findOneAndUpdate(
      { seedKey },
      {
        $set: {
          boardId: board._id,
          teamId,
          columnId: columnId(sample.column),
          title: sample.title,
          description: sample.description,
          assigneeId: assignee ? new Types.ObjectId(assignee.id) : null,
          dueDate,
          priority: sample.priority,
          order: (position + 1) * ORDER_STEP,
          sourceMeetingId: source?.meetingId ?? null,
          sourceActionItemId: source?.itemId ?? null,
          createdBy: new Types.ObjectId(persona.id),
          seeded: true,
        },
        $inc: { version: 1 },
      },
      { upsert: true, new: true },
    );

    if (source) {
      const done = DEFAULT_COLUMNS[sample.column]?.isDone ?? false;
      await MeetingInsight.updateOne(
        { meetingId: source.meetingId },
        {
          $set: {
            'actionItems.$[item].taskId': task._id,
            // The item reads as done when its task is finished, as in real use.
            'actionItems.$[item].status': done ? 'done' : 'open',
          },
        },
        { arrayFilters: [{ 'item._id': source.itemId }] },
      );
    }
  }

  // The samples come back without the discussion reviewers left on them:
  // the next reviewer's first look is the board as seeded, not somebody's
  // test comments. (A reset only happens once nobody has touched the board,
  // comments included, for an hour.)
  const samples = await Task.find({ boardId: board._id, seeded: true }).select('_id');
  await TaskComment.deleteMany({ taskId: { $in: samples.map((sample) => sample._id) } });

  return { boardId: board._id.toString(), tasks: SAMPLE_TASKS.length };
}

/** The seeded people, looked up again: the persona first, as the seed passes them. */
async function seededPeople(): Promise<SeedPerson[]> {
  const emails = [env.DEMO_EMAIL.toLowerCase(), ...DEMO_TEAMMATES.map((mate) => mate.email)];
  const users = await User.find({ email: { $in: emails } }).select('name email');
  return emails.flatMap((email) => {
    const user = users.find((entry) => entry.email === email);
    return user ? [{ id: user._id.toString(), name: user.name }] : [];
  });
}

/**
 * Puts the sample tasks back once the demo board has gone quiet.
 *
 * Runs from the housekeeping sweep. It does nothing unless something happened
 * on the board since the last reset **and** nothing has for
 * `DEMO_BOARD_RESET_IDLE_MIN`: so a board somebody is using is never reset
 * under them, and an untouched one is not rewritten every five minutes.
 * `force` skips both checks, for `demo:cleanup -- 0` right before a demo.
 */
export async function restoreDemoBoard(
  options: { now?: Date; idleMinutes?: number; force?: boolean } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const idleMinutes = options.idleMinutes ?? env.DEMO_BOARD_RESET_IDLE_MIN;

  const board = await Board.findOne({ seedKey: DEMO_BOARD_KEY }).select(
    '_id teamId activityAt restoredAt',
  );
  if (!board) return false;

  if (!options.force) {
    if (!board.activityAt) return false;
    if (board.restoredAt && board.restoredAt >= board.activityAt) return false;
    if (board.activityAt.getTime() > now.getTime() - idleMinutes * 60 * 1000) return false;
  }

  const people = await seededPeople();
  if (people.length === 0) return false;

  await seedDemoBoard({ teamId: board.teamId, people, now });
  announceBoardRefresh([board._id.toString()]);
  logger.info({ boardId: board._id.toString() }, '[demo] sample tasks restored on the demo board');
  return true;
}
