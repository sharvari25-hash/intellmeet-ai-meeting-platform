import type { AnalyticsMember, AnalyticsOverview, AnalyticsWeek } from '@intellmeet/shared';

/**
 * Numbers into words: the labels, and the one-sentence summary each chart
 * carries. The summaries are the charts' text alternative (a screen reader
 * hears the sentence, then can read the table), so they say what a sighted
 * reader would take from the picture: the total, the peak, the trend.
 */

/** "3 Aug": a week's Monday, read as a calendar day (no time-zone shift). */
export function weekLabel(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** "week of 3 Aug". */
export function weekOf(isoDate: string): string {
  return `week of ${weekLabel(isoDate)}`;
}

/** "3 Aug 2026". */
export function dayLabel(isoDate: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** 0.667 -> "67%". */
export function percent(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`;
}

/** 765 -> "12.8 h"; 45 -> "45 min". */
export function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`;
}

/** One decimal at most, never "3.0". */
export function decimal(value: number | null): string {
  if (value === null) return '–';
  return String(Math.round(value * 10) / 10);
}

// --- Summaries -------------------------------------------------------------------

export function meetingsSummary(weeks: AnalyticsWeek[]): string {
  const total = weeks.reduce((sum, week) => sum + week.meetings, 0);
  if (total === 0) return 'No meetings ended in this period.';

  const busiest = weeks.reduce((best, week) => (week.meetings > best.meetings ? week : best));
  const quietest = weeks.reduce((low, week) => (week.meetings < low.meetings ? week : low));
  const perWeek = decimal(total / weeks.length);
  const spread =
    busiest.meetings === quietest.meetings
      ? `${plural(busiest.meetings, 'meeting')} every week.`
      : `Busiest: ${weekOf(busiest.week)} (${busiest.meetings}). Quietest: ${weekOf(quietest.week)} (${quietest.meetings}).`;
  return `${plural(total, 'meeting')} over ${plural(weeks.length, 'week')}, ${perWeek} a week on average. ${spread}`;
}

export function actionItemsSummary(weeks: AnalyticsWeek[]): string {
  const created = weeks.reduce((sum, week) => sum + week.actionItemsCreated, 0);
  const completed = weeks.reduce((sum, week) => sum + week.actionItemsCompleted, 0);
  if (created === 0) return 'No action items were raised in this period.';

  // With more than one week of items, how the newest are doing: the part
  // of the picture a glance at the last bar gives.
  const withItems = weeks.filter((week) => week.actionItemsCreated > 0);
  const latest = withItems.at(-1);
  const recent =
    latest && withItems.length > 1
      ? ` Of the ${plural(latest.actionItemsCreated, 'item')} from the ${weekOf(latest.week)}, ${areDone(latest.actionItemsCompleted)} so far.`
      : '';
  return `${completed} of ${plural(created, 'action item')} raised in this period ${completed === 1 ? 'is' : 'are'} done (${percent(completed / created)}).${recent}`;
}

function areDone(count: number): string {
  if (count === 0) return 'none are done';
  return `${count} ${count === 1 ? 'is' : 'are'} done`;
}

export function outcomesSummary(items: AnalyticsOverview['actionItems']): string {
  if (items.created === 0) return 'No action items were raised in this period.';
  return `Of ${plural(items.created, 'action item')}: ${items.completed} done, ${items.open} still open and ${items.overdue} overdue.`;
}

export function completionSummary(
  members: AnalyticsMember[],
  tasks: AnalyticsOverview['tasks'] | undefined,
): string {
  const withTasks = members.filter((member) => member.tasksAssigned > 0);
  if (withTasks.length === 0) return 'Nobody was given a task in this period.';

  const best = withTasks.reduce((top, member) =>
    (member.completionRate ?? 0) > (top.completionRate ?? 0) ||
    ((member.completionRate ?? 0) === (top.completionRate ?? 0) &&
      member.tasksCompleted > top.tasksCompleted)
      ? member
      : top,
  );
  const team = tasks
    ? ` Across the team: ${tasks.completed} of ${plural(tasks.created, 'task')} (${percent(tasks.completionRate)}).`
    : '';
  return `${best.name} finished the largest share of their tasks: ${best.tasksCompleted} of ${best.tasksAssigned} (${percent(best.completionRate)}).${team}`;
}

export function activitySummary(members: AnalyticsMember[]): string {
  const [top] = members;
  if (!top || top.activity === 0)
    return 'Nobody took part in a meeting or finished a task in this period.';
  return `${top.name} was the most active: ${plural(top.meetingsAttended, 'meeting')} attended, ${plural(top.actionItemsOwned, 'action item')} owned and ${plural(top.tasksCompleted, 'task')} completed.`;
}
