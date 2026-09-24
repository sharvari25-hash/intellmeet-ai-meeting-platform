import type { PipelineStage, Types } from 'mongoose';
import type {
  AnalyticsMember,
  AnalyticsMembers,
  AnalyticsOverview,
  AnalyticsWeek,
  AnalyticsWeekly,
} from '@intellmeet/shared';
import { MeetingInsight } from '../ai/insight.model.js';
import { Message } from '../chat/message.model.js';
import { Meeting } from '../meetings/meeting.model.js';
import { Board } from '../tasks/board.model.js';
import { Task } from '../tasks/task.model.js';
import { User } from '../users/user.model.js';
import { cachedAnalytics } from './analytics.cache.js';
import { describeRange, type AnalyticsScope } from './analytics.scope.js';

/**
 * The analytics aggregations: MongoDB pipelines over one team's meetings,
 * action items and tasks, for a range of days.
 *
 * Definitions, used the same way everywhere:
 *
 * - **A meeting counts** once it has ended, started inside the range, and at
 *   least one person joined it. A meeting nobody joined (started by mistake,
 *   ended by the idle sweep) did not happen.
 * - **Its week** is the Monday-based week it started in, in the reader's time
 *   zone (`$dateTrunc` does the time-zone arithmetic).
 * - **Participants** are distinct people: rejoining does not count twice.
 * - **An action item is completed** when it was ticked off on the meeting
 *   page, or the task made from it sits in a column marked "done". Items are
 *   counted in the week of the meeting that raised them: "of what was agreed
 *   that week, how much is done now".
 * - **A task counts** when it was created in the range, on any of the team's
 *   boards, and is **completed** when it is in a "done" column.
 *
 * Nothing here knows about seeded data: the demo team's history is ordinary
 * meetings and tasks, aggregated exactly like any other team's.
 */

const round1 = (value: number) => Math.round(value * 10) / 10;

/** part / whole to three places, or null when there is no whole. */
function ratio(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null;
}

/** Every column, on any of the team's boards, whose tasks count as finished. */
async function doneColumnIds(teamId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const boards = await Board.find({ teamId }).select('columns._id columns.isDone').lean();
  return boards.flatMap((board) =>
    board.columns.flatMap((column) => (column.isDone ? [column._id] : [])),
  );
}

/** The meetings that count (see above). Served by the `teamId, status, startedAt` index. */
function countedMeetings(scope: AnalyticsScope): PipelineStage.Match {
  return {
    $match: {
      teamId: scope.teamId,
      status: 'ended',
      startedAt: { $gte: scope.start, $lt: scope.end },
      endedAt: { $ne: null },
      'participants.0': { $exists: true },
    },
  };
}

/** The Monday of the week a date falls in, in the scope's time zone, as `YYYY-MM-DD`. */
function weekOf(field: string, tz: string) {
  return {
    $dateToString: {
      format: '%Y-%m-%d',
      timezone: tz,
      date: { $dateTrunc: { date: field, unit: 'week', startOfWeek: 'monday', timezone: tz } },
    },
  };
}

const meetingSeconds = {
  $max: [0, { $divide: [{ $subtract: ['$endedAt', '$startedAt'] }, 1000] }],
};

/** Distinct people in a meeting. */
const peopleInMeeting = { $size: { $setUnion: ['$participants.userId', []] } };

interface MeetingTotals {
  _id: string | null;
  meetings: number;
  seconds: number;
  people: number;
}

function meetingTotals(scope: AnalyticsScope, byWeek: boolean): Promise<MeetingTotals[]> {
  return Meeting.aggregate<MeetingTotals>([
    countedMeetings(scope),
    {
      $group: {
        _id: byWeek ? weekOf('$startedAt', scope.tz) : null,
        meetings: { $sum: 1 },
        seconds: { $sum: meetingSeconds },
        people: { $sum: peopleInMeeting },
      },
    },
  ]);
}

/**
 * One row per action item raised in a counted meeting: its week, owner, and
 * whether it is done or overdue. The task behind an item is looked up to see
 * which column it is in.
 */
function actionItemRows(scope: AnalyticsScope, doneColumns: Types.ObjectId[]): PipelineStage[] {
  return [
    countedMeetings(scope),
    { $project: { week: weekOf('$startedAt', scope.tz) } },
    {
      $lookup: {
        from: MeetingInsight.collection.collectionName,
        localField: '_id',
        foreignField: 'meetingId',
        pipeline: [{ $project: { actionItems: 1 } }],
        as: 'insight',
      },
    },
    { $unwind: '$insight' },
    { $unwind: '$insight.actionItems' },
    {
      $project: {
        week: 1,
        assigneeId: '$insight.actionItems.assigneeId',
        dueDate: '$insight.actionItems.dueDate',
        status: '$insight.actionItems.status',
        taskId: '$insight.actionItems.taskId',
      },
    },
    {
      $lookup: {
        from: Task.collection.collectionName,
        localField: 'taskId',
        foreignField: '_id',
        pipeline: [{ $project: { columnId: 1 } }],
        as: 'task',
      },
    },
    {
      $set: {
        done: {
          $or: [
            { $eq: ['$status', 'done'] },
            { $gt: [{ $size: { $setIntersection: ['$task.columnId', doneColumns] } }, 0] },
          ],
        },
      },
    },
    {
      $set: {
        // Due dates are `YYYY-MM-DD` strings, so they compare as dates.
        overdue: {
          $and: [
            { $not: ['$done'] },
            { $eq: [{ $type: '$dueDate' }, 'string'] },
            { $lt: ['$dueDate', scope.today] },
          ],
        },
      },
    },
  ];
}

interface ItemTotals {
  _id: string | Types.ObjectId | null;
  created: number;
  completed: number;
  overdue: number;
}

function itemTotals(
  scope: AnalyticsScope,
  doneColumns: Types.ObjectId[],
  groupBy: null | '$week' | '$assigneeId',
): Promise<ItemTotals[]> {
  return Meeting.aggregate<ItemTotals>([
    ...actionItemRows(scope, doneColumns),
    ...(groupBy === '$assigneeId' ? [{ $match: { assigneeId: { $ne: null } } }] : []),
    {
      $group: {
        _id: groupBy,
        created: { $sum: 1 },
        completed: { $sum: { $cond: ['$done', 1, 0] } },
        overdue: { $sum: { $cond: ['$overdue', 1, 0] } },
      },
    },
  ]);
}

interface TaskTotals {
  _id: Types.ObjectId | null;
  created: number;
  completed: number;
}

/** Tasks created in the range, in total or per assignee. */
function taskTotals(
  scope: AnalyticsScope,
  doneColumns: Types.ObjectId[],
  byAssignee: boolean,
): Promise<TaskTotals[]> {
  return Task.aggregate<TaskTotals>([
    {
      $match: {
        teamId: scope.teamId,
        createdAt: { $gte: scope.start, $lt: scope.end },
        ...(byAssignee ? { assigneeId: { $ne: null } } : {}),
      },
    },
    {
      $group: {
        _id: byAssignee ? '$assigneeId' : null,
        created: { $sum: 1 },
        completed: { $sum: { $cond: [{ $in: ['$columnId', doneColumns] }, 1, 0] } },
      },
    },
  ]);
}

function cacheParts(scope: AnalyticsScope): string[] {
  return [scope.from, scope.to, scope.tz, scope.today];
}

// --- Overview --------------------------------------------------------------------

/** The headline numbers for the range. */
export function getOverview(scope: AnalyticsScope): Promise<AnalyticsOverview> {
  return cachedAnalytics('overview', scope.teamId.toString(), cacheParts(scope), async () => {
    const doneColumns = await doneColumnIds(scope.teamId);
    const [[meetings], [items], [tasks]] = await Promise.all([
      meetingTotals(scope, false),
      itemTotals(scope, doneColumns, null),
      taskTotals(scope, doneColumns, false),
    ]);

    const count = meetings?.meetings ?? 0;
    const created = items?.created ?? 0;
    const completed = items?.completed ?? 0;
    const overdue = items?.overdue ?? 0;

    return {
      range: describeRange(scope),
      meetings: {
        count,
        totalMinutes: round1((meetings?.seconds ?? 0) / 60),
        averageMinutes: count > 0 ? round1((meetings?.seconds ?? 0) / 60 / count) : null,
        averageParticipants: count > 0 ? round1((meetings?.people ?? 0) / count) : null,
      },
      actionItems: { created, completed, open: created - completed - overdue, overdue },
      tasks: {
        created: tasks?.created ?? 0,
        completed: tasks?.completed ?? 0,
        completionRate: ratio(tasks?.completed ?? 0, tasks?.created ?? 0),
      },
      generatedAt: new Date().toISOString(),
    };
  });
}

// --- Weekly ----------------------------------------------------------------------

/** One row per week of the range, including the empty ones. */
export function getWeekly(scope: AnalyticsScope): Promise<AnalyticsWeekly> {
  return cachedAnalytics('weekly', scope.teamId.toString(), cacheParts(scope), async () => {
    const doneColumns = await doneColumnIds(scope.teamId);
    const [meetings, items] = await Promise.all([
      meetingTotals(scope, true),
      itemTotals(scope, doneColumns, '$week'),
    ]);
    const meetingsByWeek = new Map(meetings.map((row) => [String(row._id), row]));
    const itemsByWeek = new Map(items.map((row) => [String(row._id), row]));

    const weeks: AnalyticsWeek[] = scope.weeks.map((week) => {
      const meeting = meetingsByWeek.get(week);
      const item = itemsByWeek.get(week);
      const count = meeting?.meetings ?? 0;
      return {
        week,
        meetings: count,
        totalMinutes: round1((meeting?.seconds ?? 0) / 60),
        averageMinutes: count > 0 ? round1((meeting?.seconds ?? 0) / 60 / count) : null,
        averageParticipants: count > 0 ? round1((meeting?.people ?? 0) / count) : null,
        actionItemsCreated: item?.created ?? 0,
        actionItemsCompleted: item?.completed ?? 0,
      };
    });

    return { range: describeRange(scope), weeks, generatedAt: new Date().toISOString() };
  });
}

// --- Members -----------------------------------------------------------------------

interface Attendance {
  attended: { _id: Types.ObjectId; meetings: number; seconds: number }[];
  hosted: { _id: Types.ObjectId; hosted: number }[];
  messages: { _id: Types.ObjectId; sent: number }[];
}

/**
 * Per person, in one pass over the counted meetings: meetings attended and
 * the time actually spent in them (each join to each leave, clipped to the
 * meeting), meetings hosted, and chat messages sent.
 */
async function attendance(scope: AnalyticsScope): Promise<Attendance> {
  const presentSeconds = {
    $max: [
      0,
      {
        $divide: [
          {
            $subtract: [
              { $min: [{ $ifNull: ['$participants.leftAt', '$endedAt'] }, '$endedAt'] },
              { $max: ['$participants.joinedAt', '$startedAt'] },
            ],
          },
          1000,
        ],
      },
    ],
  };

  const [result] = await Meeting.aggregate<Attendance>([
    countedMeetings(scope),
    {
      $facet: {
        attended: [
          { $unwind: '$participants' },
          {
            $group: {
              _id: '$participants.userId',
              meetingIds: { $addToSet: '$_id' },
              seconds: { $sum: presentSeconds },
            },
          },
          { $project: { meetings: { $size: '$meetingIds' }, seconds: 1 } },
        ],
        hosted: [{ $group: { _id: '$hostId', hosted: { $sum: 1 } } }],
        messages: [
          {
            $lookup: {
              from: Message.collection.collectionName,
              localField: '_id',
              foreignField: 'meetingId',
              pipeline: [{ $project: { senderId: 1 } }],
              as: 'message',
            },
          },
          { $unwind: '$message' },
          { $group: { _id: '$message.senderId', sent: { $sum: 1 } } },
        ],
      },
    },
  ]);
  return result ?? { attended: [], hosted: [], messages: [] };
}

type Tally = Omit<AnalyticsMember, 'userId' | 'name' | 'isMember' | 'completionRate' | 'activity'>;

const EMPTY_TALLY: Tally = {
  meetingsAttended: 0,
  meetingsHosted: 0,
  minutesInMeetings: 0,
  messagesSent: 0,
  actionItemsOwned: 0,
  actionItemsCompleted: 0,
  tasksAssigned: 0,
  tasksCompleted: 0,
};

/** What the members aggregation caches: numbers per person, no names. */
interface MemberTallies {
  tallies: [userId: string, tally: Tally][];
  generatedAt: string;
}

/**
 * Everyone who did anything in the range, most active first.
 *
 * Only the numbers are cached. Names and "still in the team" are looked up
 * on every request, like `isHost` on a cached meeting: someone who renames
 * themselves or leaves shows up that way at once, and nothing about who a
 * person is has to be invalidated. It is one `$in` over the few people who
 * appear.
 */
export async function getMembers(scope: AnalyticsScope): Promise<AnalyticsMembers> {
  const { tallies, generatedAt } = await memberTallies(scope);

  const users = await User.find({ _id: { $in: tallies.map(([userId]) => userId) } })
    .select('name')
    .lean();
  const names = new Map(users.map((user) => [user._id.toString(), user.name]));

  const members: AnalyticsMember[] = tallies.map(([userId, entry]) => ({
    userId,
    // A deleted account (a guest whose session ended, say) keeps its numbers
    // in the totals but has no name to show.
    name: names.get(userId) ?? 'Former member',
    isMember: scope.memberIds.has(userId) && names.has(userId),
    ...entry,
    completionRate: ratio(entry.tasksCompleted, entry.tasksAssigned),
    activity: entry.meetingsAttended + entry.actionItemsOwned + entry.tasksCompleted,
  }));

  members.sort(
    (a, b) =>
      b.activity - a.activity ||
      b.meetingsAttended - a.meetingsAttended ||
      a.name.localeCompare(b.name),
  );

  return { range: describeRange(scope), members, generatedAt };
}

function memberTallies(scope: AnalyticsScope): Promise<MemberTallies> {
  return cachedAnalytics('members', scope.teamId.toString(), cacheParts(scope), async () => {
    const doneColumns = await doneColumnIds(scope.teamId);
    const [presence, items, tasks] = await Promise.all([
      attendance(scope),
      itemTotals(scope, doneColumns, '$assigneeId'),
      taskTotals(scope, doneColumns, true),
    ]);

    const tallies = new Map<string, Tally>();
    const tally = (id: unknown): Tally => {
      const key = String(id);
      let entry = tallies.get(key);
      if (!entry) {
        entry = { ...EMPTY_TALLY };
        tallies.set(key, entry);
      }
      return entry;
    };

    for (const row of presence.attended) {
      const entry = tally(row._id);
      entry.meetingsAttended = row.meetings;
      entry.minutesInMeetings = round1(row.seconds / 60);
    }
    for (const row of presence.hosted) tally(row._id).meetingsHosted = row.hosted;
    for (const row of presence.messages) tally(row._id).messagesSent = row.sent;
    for (const row of items) {
      const entry = tally(row._id);
      entry.actionItemsOwned = row.created;
      entry.actionItemsCompleted = row.completed;
    }
    for (const row of tasks) {
      const entry = tally(row._id);
      entry.tasksAssigned = row.created;
      entry.tasksCompleted = row.completed;
    }

    return { tallies: [...tallies.entries()], generatedAt: new Date().toISOString() };
  });
}
