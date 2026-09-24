import { AlertTriangle, CheckCircle2, CircleDashed, type LucideIcon } from 'lucide-react';
import type { AnalyticsMember, AnalyticsOverview } from '@intellmeet/shared';

/**
 * The rows the member and outcome charts draw, shared with their tables so a
 * chart and its table always list the same things in the same order.
 */

/** Chart rows are capped so a phone can show them; the table lists everyone. */
export const MEMBER_CHART_LIMIT = 8;

export interface Outcome {
  key: 'done' | 'open' | 'overdue';
  label: string;
  value: number;
  color: string;
  /** Status colours never stand alone: each has an icon and a word. */
  icon: LucideIcon;
}

export function outcomesOf(items: AnalyticsOverview['actionItems']): Outcome[] {
  return [
    {
      key: 'done',
      label: 'Done',
      value: items.completed,
      color: 'var(--chart-good)',
      icon: CheckCircle2,
    },
    {
      key: 'open',
      label: 'Open',
      value: items.open,
      color: 'var(--chart-rest)',
      icon: CircleDashed,
    },
    {
      key: 'overdue',
      label: 'Overdue',
      value: items.overdue,
      color: 'var(--chart-critical)',
      icon: AlertTriangle,
    },
  ];
}

/** Members with tasks, the highest completion rate first (ties: more tasks first). */
export function completionRows(members: AnalyticsMember[]): AnalyticsMember[] {
  return members
    .filter((member) => member.tasksAssigned > 0)
    .sort(
      (a, b) =>
        (b.completionRate ?? 0) - (a.completionRate ?? 0) ||
        b.tasksAssigned - a.tasksAssigned ||
        a.name.localeCompare(b.name),
    );
}
