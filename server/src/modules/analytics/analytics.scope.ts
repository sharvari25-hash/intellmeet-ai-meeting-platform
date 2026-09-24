import { Types } from 'mongoose';
import {
  ANALYTICS_DEFAULT_WEEKS,
  ANALYTICS_MAX_RANGE_DAYS,
  addDays,
  daysInclusive,
  rangeForWeeks,
  todayIn,
  weekStarts,
  type AnalyticsQuery,
  type AnalyticsRange,
} from '@intellmeet/shared';
import { AppError } from '../../lib/errors.js';
import { Team } from '../teams/team.model.js';

/**
 * What one analytics request is about: a team the caller belongs to, and a
 * range of days turned into instants in the caller's time zone.
 */
export interface AnalyticsScope {
  teamId: Types.ObjectId;
  teamName: string;
  teamSlug: string;
  /** Current members, to tell them apart from people who have left. */
  memberIds: Set<string>;
  /** Inclusive calendar days, `YYYY-MM-DD`. */
  from: string;
  to: string;
  tz: string;
  /** Today in `tz`: an open action item due before this is overdue. */
  today: string;
  /** `from` 00:00 in `tz`, inclusive. */
  start: Date;
  /** The midnight after `to` in `tz`, exclusive. */
  end: Date;
  /** Each week's Monday, oldest first. */
  weeks: string[];
}

/** How far `tz` is ahead of UTC at `instant`, in milliseconds. */
function offsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a calendar day starts in a time zone: `2026-09-24` in
 * `Asia/Kolkata` is `2026-09-23T18:30:00Z`.
 *
 * Guess with the offset at UTC midnight, then correct with the offset at the
 * guess. The second pass is what gets a day right when a daylight-saving
 * change falls between the two instants.
 */
export function zonedDayStart(isoDate: string, tz: string): Date {
  const midnightUtc = Date.parse(`${isoDate}T00:00:00.000Z`);
  const guess = midnightUtc - offsetMs(midnightUtc, tz);
  return new Date(midnightUtc - offsetMs(guess, tz));
}

function rangeError(path: string, message: string): AppError {
  return AppError.validation([{ path: `query.${path}`, message }]);
}

/**
 * Checks the caller belongs to the team and resolves the range.
 *
 * Every analytics endpoint calls this first, before any cache is consulted:
 * the answer to "may this person see this team" is never cached. A team the
 * caller is not in is "not found", as everywhere else, so a team id reveals
 * nothing about another tenant.
 *
 * Missing dates default to the last eight weeks up to today in `tz`.
 */
export async function resolveScope(
  query: AnalyticsQuery,
  userId: string,
  now: Date = new Date(),
): Promise<AnalyticsScope> {
  const team = await Team.findOne({ _id: query.teamId, 'members.userId': userId }).select(
    'name slug members.userId',
  );
  if (!team) throw AppError.notFound('Team not found');

  const today = todayIn(query.tz, now);
  const to = query.to ?? today;
  const from = query.from ?? rangeForWeeks(ANALYTICS_DEFAULT_WEEKS, to).from;

  if (from > to) throw rangeError('from', '`from` must not be after `to`');
  if (daysInclusive(from, to) > ANALYTICS_MAX_RANGE_DAYS) {
    throw rangeError('from', `A range can be at most ${ANALYTICS_MAX_RANGE_DAYS} days`);
  }

  return {
    teamId: new Types.ObjectId(team._id),
    teamName: team.name,
    teamSlug: team.slug,
    memberIds: new Set(team.members.map((member) => member.userId.toString())),
    from,
    to,
    tz: query.tz,
    today,
    start: zonedDayStart(from, query.tz),
    end: zonedDayStart(addDays(to, 1), query.tz),
    weeks: weekStarts(from, to),
  };
}

/** The range as the responses describe it. */
export function describeRange(scope: AnalyticsScope): AnalyticsRange {
  return {
    teamId: scope.teamId.toString(),
    teamName: scope.teamName,
    from: scope.from,
    to: scope.to,
    tz: scope.tz,
    weeks: scope.weeks,
  };
}
