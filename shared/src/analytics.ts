import { z } from 'zod';
import { objectIdSchema } from './common.js';

/**
 * Team analytics (Phase 9).
 *
 * A range of calendar days in the reader's time zone, one team at a time.
 * Everything is bucketed into weeks that start on Monday, in that time zone,
 * so "the week of 14 Sep" means the same days to the chart, the table and
 * the CSV.
 *
 * Dates travel as `YYYY-MM-DD` strings, never as instants: a day is a day
 * wherever the reader is, and the server turns it into instants itself, in
 * the time zone the request names.
 */

// --- Limits and defaults -------------------------------------------------------

/** What the dashboard opens on: this week and the seven before it. */
export const ANALYTICS_DEFAULT_WEEKS = 8;

/** The presets the date-range control offers, in weeks. */
export const ANALYTICS_PRESET_WEEKS = [4, 8, 12] as const;

/**
 * The longest range one request may ask for. Bounds the work a single
 * aggregation does (53 weekly buckets at most) and the size of a CSV.
 */
export const ANALYTICS_MAX_RANGE_DAYS = 366;

/** Aggregations are cached this long (and invalidated early by task and meeting writes). */
export const ANALYTICS_CACHE_TTL_SEC = 5 * 60;

// --- Calendar helpers (pure date strings, no time zones) -----------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** `isoDate` plus `days` calendar days. */
export function addDays(isoDate: string, days: number): string {
  const date = parseDay(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`, counting both ends. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS) + 1;
}

/** The Monday on or before `isoDate`. */
export function startOfWeek(isoDate: string): string {
  const weekday = parseDay(isoDate).getUTCDay(); // 0 is Sunday
  return addDays(isoDate, -((weekday + 6) % 7));
}

/**
 * Every week (by its Monday) that overlaps `from`..`to`, oldest first. The
 * first may start before `from`: a range beginning on a Thursday still shows
 * that week, holding only the days inside the range.
 */
export function weekStarts(from: string, to: string): string[] {
  const weeks: string[] = [];
  for (let week = startOfWeek(from); week <= to; week = addDays(week, 7)) weeks.push(week);
  return weeks;
}

/** Today's date in a time zone, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * The last `weeks` weeks up to `today`: from the Monday `weeks - 1` weeks
 * before this one, to today. Whole weeks, so the first bucket is not a
 * partial one; only the current week is still in progress.
 */
export function rangeForWeeks(weeks: number, today: string): { from: string; to: string } {
  return { from: addDays(startOfWeek(today), -7 * (weeks - 1)), to: today };
}

/** True for a time zone this runtime knows (`UTC`, `Asia/Kolkata`, ...). */
export function isKnownTimeZone(value: string): boolean {
  // IANA names only: no offsets, no POSIX strings. MongoDB's date operators
  // accept the same Olson names, so a zone that passes here works there.
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// --- Requests --------------------------------------------------------------------

const isoDaySchema = z.iso.date({ message: 'Must be a date (YYYY-MM-DD)' });

/**
 * One team, a range of days, and the time zone they are days in.
 *
 * `from` and `to` are optional: the server fills in the default range (the
 * last eight weeks) from today in `tz`, which is also what makes the
 * endpoints easy to call by hand.
 */
export const analyticsQuerySchema = z
  .object({
    teamId: objectIdSchema,
    from: isoDaySchema.optional(),
    to: isoDaySchema.optional(),
    tz: z.string().max(64).refine(isKnownTimeZone, { message: 'Unknown time zone' }).default('UTC'),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  })
  .refine(
    (query) =>
      !query.from || !query.to || daysInclusive(query.from, query.to) <= ANALYTICS_MAX_RANGE_DAYS,
    { message: `A range can be at most ${ANALYTICS_MAX_RANGE_DAYS} days`, path: ['to'] },
  );
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** The two tables the CSV export offers. */
export const ANALYTICS_DATASETS = ['weekly', 'members'] as const;
export const analyticsDatasetSchema = z.enum(ANALYTICS_DATASETS);
export type AnalyticsDataset = z.infer<typeof analyticsDatasetSchema>;

export const analyticsExportQuerySchema = analyticsQuerySchema.and(
  z.object({ dataset: analyticsDatasetSchema }),
);
export type AnalyticsExportQuery = z.infer<typeof analyticsExportQuerySchema>;

// --- Responses ---------------------------------------------------------------------

/** The range the numbers are for, with the defaults filled in. */
export const analyticsRangeSchema = z.object({
  teamId: objectIdSchema,
  teamName: z.string(),
  from: z.string(),
  to: z.string(),
  tz: z.string(),
  /** Each week's Monday, oldest first. */
  weeks: z.array(z.string()),
});
export type AnalyticsRange = z.infer<typeof analyticsRangeSchema>;

const count = z.number().int().nonnegative();
/** An average or a rate, or null when there was nothing to average. */
const measure = z.number().nonnegative().nullable();

export const analyticsOverviewSchema = z.object({
  range: analyticsRangeSchema,
  meetings: z.object({
    /** Meetings that ended in the range and that somebody joined. */
    count,
    totalMinutes: z.number().nonnegative(),
    averageMinutes: measure,
    /** People per meeting, each counted once however often they rejoined. */
    averageParticipants: measure,
  }),
  /** Action items raised in those meetings, and what became of them. */
  actionItems: z.object({
    created: count,
    /** Ticked off on the meeting page, or its task is in a "done" column. */
    completed: count,
    /** Not done and not yet due (or with no due date). */
    open: count,
    /** Not done and past its due date. */
    overdue: count,
  }),
  /** Tasks created in the range, on any of the team's boards. */
  tasks: z.object({
    created: count,
    completed: count,
    /** completed / created, 0..1. */
    completionRate: measure,
  }),
  /** When these numbers were computed (they may come from the cache). */
  generatedAt: z.string(),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

export const analyticsWeekSchema = z.object({
  /** The week's Monday. */
  week: z.string(),
  meetings: count,
  totalMinutes: z.number().nonnegative(),
  averageMinutes: measure,
  averageParticipants: measure,
  /** Action items raised in that week's meetings... */
  actionItemsCreated: count,
  /** ...and how many of those are done now. */
  actionItemsCompleted: count,
});
export type AnalyticsWeek = z.infer<typeof analyticsWeekSchema>;

export const analyticsWeeklySchema = z.object({
  range: analyticsRangeSchema,
  weeks: z.array(analyticsWeekSchema),
  generatedAt: z.string(),
});
export type AnalyticsWeekly = z.infer<typeof analyticsWeeklySchema>;

export const analyticsMemberSchema = z.object({
  userId: objectIdSchema,
  name: z.string(),
  /** False for someone who has since left the team (or whose account is gone). */
  isMember: z.boolean(),
  meetingsAttended: count,
  meetingsHosted: count,
  /** Time actually spent in those meetings, from each join to each leave. */
  minutesInMeetings: z.number().nonnegative(),
  messagesSent: count,
  actionItemsOwned: count,
  actionItemsCompleted: count,
  tasksAssigned: count,
  tasksCompleted: count,
  /** tasksCompleted / tasksAssigned, 0..1; null with no tasks. */
  completionRate: measure,
  /** meetingsAttended + actionItemsOwned + tasksCompleted: the "most active" ranking. */
  activity: count,
});
export type AnalyticsMember = z.infer<typeof analyticsMemberSchema>;

export const analyticsMembersSchema = z.object({
  range: analyticsRangeSchema,
  /** Everyone with any activity in the range, most active first. */
  members: z.array(analyticsMemberSchema),
  generatedAt: z.string(),
});
export type AnalyticsMembers = z.infer<typeof analyticsMembersSchema>;
