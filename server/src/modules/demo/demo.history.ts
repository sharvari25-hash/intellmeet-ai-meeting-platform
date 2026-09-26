import { Types } from 'mongoose';
import { ROOM_CODE_LENGTH, type TranscriptSegment } from '@intellmeet/shared';
import { env } from '../../config/env.js';
import { generateCode } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { MeetingInsight } from '../ai/insight.model.js';
import { Transcript } from '../ai/transcript.model.js';
import { invalidateTeamAnalytics } from '../analytics/analytics.cache.js';
import { Meeting } from '../meetings/meeting.model.js';
import { deleteMeetingArtifacts } from '../meetings/meeting.service.js';
import { Board } from '../tasks/board.model.js';
import { announceBoardRefresh } from '../tasks/task.events.js';
import { Team } from '../teams/team.model.js';
import { DEMO_BOARD_KEY, seedDemoBoard, seededPeople } from './demo.board.js';
import { DEMO_TEAM_SLUG } from './demo.constants.js';
import {
  HISTORY_MEETINGS,
  HISTORY_PREFIX,
  historyActionItemId,
  historyDueDate,
  historySeedKey,
  historyTimes,
  type HistoryActionItem,
  type HistoryMeeting,
} from './demo.history.data.js';
import { seedDemoMeetings, setCreatedAt, type SeedPerson } from './demo.meetings.js';

/**
 * The demo team's longer history (`demo.history.data.ts`): real meetings,
 * marked `seeded`, so the analytics dashboard has weeks of data to chart and
 * the meeting history reads like a team that has been at it for a while.
 *
 * Real meetings rather than analytics-only numbers kept somewhere else, so
 * the charts are computed by the same aggregations as any team's, from the
 * same documents the history page lists: a reviewer who sees "21 meetings"
 * on the dashboard finds them under Meetings, and one who ticks off an item
 * or moves a task sees the chart change.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * A short transcript that says what the minutes say: the host opens, the
 * decisions are agreed, each owner takes their item ("I'll ... by Friday"),
 * the host closes. Spread across the meeting's length, so timestamps and
 * durations agree. Written the way the mock AI reads transcripts, so a
 * reviewer searching for a word from an action item finds the line it was
 * said in.
 */
export function historyTranscript(meeting: HistoryMeeting, now: Date): TranscriptSegment[] {
  const lines: { speaker: string; text: string }[] = [
    { speaker: meeting.host, text: meeting.opening },
    ...meeting.decisions.map((decision) => ({
      speaker: meeting.host,
      text: `So we are agreed: ${lowerFirst(decision)}.`,
    })),
    ...meeting.actionItems.map((item) => ({
      speaker: item.owner,
      text: ownerLine(meeting, item, now),
    })),
    { speaker: meeting.host, text: 'Thanks, everyone. That is all for today.' },
  ];

  const step = (meeting.minutes * 60) / (lines.length + 1);
  return lines.map((line, index) => {
    const start = Math.round(step * index + (index === 0 ? 5 : 0));
    return {
      start,
      end: start + Math.min(Math.round(step) - 1, 18),
      text: line.text,
      speaker: line.speaker,
    };
  });
}

function ownerLine(meeting: HistoryMeeting, item: HistoryActionItem, now: Date): string {
  const due = historyDueDate(meeting, item, now);
  const by = due ? ` by ${WEEKDAYS[new Date(`${due}T00:00:00Z`).getUTCDay()]}` : '';
  return `I'll ${lowerFirst(item.text)}${by}.`;
}

export interface SeedHistoryResult {
  created: number;
  updated: number;
  /** History meetings no longer in the data, deleted. */
  removed: number;
}

/**
 * Creates (or moves forward) the history meetings, with their transcripts
 * and insights.
 *
 * Idempotent in the seed's usual way: upserted by `seedKey`, with dates
 * recomputed from `now`, so a re-run a week later moves every meeting a
 * week forward instead of adding more. Action item ids are stable, and a
 * task somebody made from an open item keeps its link. The tasks that were
 * finished on the board are the board seed's job (`seedDemoBoard`), which
 * therefore runs after this.
 */
export async function seedDemoHistory(options: {
  teamId: string | Types.ObjectId;
  people: SeedPerson[];
  now?: Date;
}): Promise<SeedHistoryResult> {
  const now = options.now ?? new Date();
  const teamId = new Types.ObjectId(String(options.teamId));
  const result: SeedHistoryResult = { created: 0, updated: 0, removed: 0 };

  const byName = (name: string) => options.people.find((person) => person.name === name);

  for (const template of HISTORY_MEETINGS) {
    const seedKey = historySeedKey(template);
    const { startedAt, endedAt } = historyTimes(template, now);
    const host = byName(template.host) ?? options.people[0];
    if (!host) throw new Error('seedDemoHistory needs at least one person');

    const attendees = template.attendees.flatMap((name) => byName(name) ?? []);

    const existing = await Meeting.exists({ seedKey });
    const meeting = await Meeting.findOneAndUpdate(
      { seedKey },
      {
        $set: {
          teamId,
          title: template.title,
          description: null,
          hostId: new Types.ObjectId(host.id),
          status: 'ended',
          scheduledAt: null,
          startedAt,
          endedAt,
          lastActiveAt: endedAt,
          // A few seconds apart, as people arrive; everyone stays to the end.
          participants: attendees.map((person, index) => ({
            userId: new Types.ObjectId(person.id),
            joinedAt: new Date(startedAt.getTime() + index * 40 * 1000),
            leftAt: endedAt,
          })),
          recording: { status: 'none' },
          aiStatus: 'done',
          aiError: null,
          seeded: true,
          updatedAt: endedAt,
        },
        $setOnInsert: { roomCode: generateCode(ROOM_CODE_LENGTH), seedKey },
      },
      { upsert: true, new: true, timestamps: false },
    );
    await setCreatedAt(Meeting.collection, meeting._id, startedAt);

    const segments = historyTranscript(template, now);
    await Transcript.findOneAndUpdate(
      { meetingId: meeting._id },
      {
        $set: {
          text: segments.map((segment) => segment.text).join(' '),
          segments,
          language: 'en',
          provider: 'seed',
        },
      },
      { upsert: true },
    );

    // Links reviewers made from open items survive a re-seed, as with the
    // sample meetings. Items that were finished as tasks are linked again by
    // the board seed.
    const previous = await MeetingInsight.findOne({ meetingId: meeting._id })
      .select('actionItems._id actionItems.taskId')
      .lean();
    const taskIds = new Map(
      (previous?.actionItems ?? []).flatMap((item) =>
        item._id && item.taskId ? [[item._id.toString(), item.taskId] as const] : [],
      ),
    );

    await MeetingInsight.findOneAndUpdate(
      { meetingId: meeting._id },
      {
        $set: {
          summary: template.summary,
          keyDecisions: template.decisions,
          actionItems: template.actionItems.map((item, index) => {
            const id = historyActionItemId(template.key, index);
            const owner = byName(item.owner);
            return {
              _id: id,
              text: item.text,
              assigneeName: owner?.name ?? item.owner,
              assigneeId: owner ? new Types.ObjectId(owner.id) : null,
              dueDate: historyDueDate(template, item, now),
              status: item.outcome === 'open' ? 'open' : 'done',
              taskId: taskIds.get(id.toString()) ?? null,
            };
          }),
          provider: 'seed',
          editedAt: null,
          editedBy: null,
          editedByName: null,
        },
      },
      { upsert: true },
    );

    if (existing) result.updated += 1;
    else result.created += 1;
  }

  // A meeting taken out of the history data (or renamed) goes, with its
  // transcript and insight: the demo cleanup never deletes seeded meetings,
  // so nothing else would.
  const retired = await Meeting.find({
    seeded: true,
    seedKey: { $regex: `^${HISTORY_PREFIX}`, $nin: HISTORY_MEETINGS.map(historySeedKey) },
  }).select('_id teamId roomCode recording');
  if (retired.length > 0) {
    await deleteMeetingArtifacts(retired);
    await Meeting.deleteMany({ _id: { $in: retired.map((meeting) => meeting._id) } });
    result.removed = retired.length;
  }

  return result;
}

/** Whether the history is placed for the week `now` is in (checked on its first meeting). */
async function historyIsCurrent(now: Date): Promise<boolean> {
  const reference = HISTORY_MEETINGS[0];
  if (!reference) return true;
  const stored = await Meeting.findOne({ seedKey: historySeedKey(reference) }).select('startedAt');
  return stored?.startedAt?.getTime() === historyTimes(reference, now).startedAt.getTime();
}

/**
 * Keeps the seeded history recent: once a week, moves the sample meetings,
 * the history and the seeded tasks forward to end where they would if the
 * seed had run today. Runs from the housekeeping sweep.
 *
 * Without it, "the last eight weeks" on a deployment seeded a month ago would
 * be half empty, and its newest meetings a month old. Whole weeks only, so a
 * Tuesday sync stays a Tuesday sync. It also fills the history in on a
 * database seeded before it existed.
 *
 * Does nothing unless the seeded team exists (nothing to keep fresh on a
 * database that was never seeded) and the history is not already placed for
 * this week, which is one indexed read. The seeded tasks are re-dated with
 * the board, and only when nobody is using it; otherwise the board's own
 * reset does it once it goes quiet.
 */
export async function refreshDemoHistory(
  options: { now?: Date; idleMinutes?: number } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();

  const team = await Team.findOne({ slug: DEMO_TEAM_SLUG }).select('_id');
  if (!team) return false;
  if (await historyIsCurrent(now)) return false;

  const people = await seededPeople();
  if (people.length === 0) return false;

  await seedDemoMeetings({ teamId: team._id.toString(), people, now });
  await seedDemoHistory({ teamId: team._id, people, now });

  const board = await Board.findOne({ seedKey: DEMO_BOARD_KEY }).select('_id activityAt');
  const idleMs = (options.idleMinutes ?? env.DEMO_BOARD_RESET_IDLE_MIN) * 60 * 1000;
  const quiet = !board?.activityAt || board.activityAt.getTime() <= now.getTime() - idleMs;
  if (board && quiet) {
    await seedDemoBoard({ teamId: team._id, people, now });
    announceBoardRefresh([board._id.toString()]);
  }

  await invalidateTeamAnalytics([team._id]);
  logger.info({ boardRedated: Boolean(board && quiet) }, '[demo] seeded history moved forward');
  return true;
}
