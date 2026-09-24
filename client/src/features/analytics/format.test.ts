import { describe, expect, it } from 'vitest';
import { MEMBERS, OVERVIEW, WEEKS, member, week } from '@/test/analyticsFixtures';
import {
  actionItemsSummary,
  activitySummary,
  completionSummary,
  decimal,
  duration,
  meetingsSummary,
  outcomesSummary,
  percent,
  weekOf,
} from './format';

describe('analytics formatting', () => {
  it('formats durations, rates and averages for people', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(59.6)).toBe('60 min');
    expect(duration(266)).toBe('4.4 h');
    expect(duration(765)).toBe('13 h');
    expect(percent(0.667)).toBe('67%');
    expect(percent(null)).toBe('–');
    expect(decimal(3)).toBe('3');
    expect(decimal(3.46)).toBe('3.5');
    expect(decimal(null)).toBe('–');
  });
});

describe('chart summaries (the charts’ text alternative)', () => {
  it('names the total, the average, and the busiest and quietest weeks', () => {
    expect(meetingsSummary(WEEKS)).toBe(
      `8 meetings over 3 weeks, 2.7 a week on average. Busiest: ${weekOf('2026-09-14')} (4). Quietest: ${weekOf('2026-09-21')} (1).`,
    );
    const steady = [
      week({ week: '2026-09-07', meetings: 2 }),
      week({ week: '2026-09-14', meetings: 2 }),
    ];
    expect(meetingsSummary(steady)).toBe(
      '4 meetings over 2 weeks, 2 a week on average. 2 meetings every week.',
    );
    expect(meetingsSummary([week({ week: '2026-09-07' })])).toBe(
      'No meetings ended in this period.',
    );
  });

  it('says how much of what was agreed got done, and how the newest items are doing', () => {
    expect(actionItemsSummary(WEEKS)).toBe(
      `9 of 20 action items raised in this period are done (45%). Of the 4 items from the ${weekOf('2026-09-21')}, none are done so far.`,
    );
    // One week of items: nothing to compare the latest with.
    const one = [week({ week: '2026-09-07', actionItemsCreated: 1, actionItemsCompleted: 1 })];
    expect(actionItemsSummary(one)).toBe(
      '1 of 1 action item raised in this period is done (100%).',
    );
    expect(actionItemsSummary([week({ week: '2026-09-07' })])).toBe(
      'No action items were raised in this period.',
    );
  });

  it('spells out the outcomes the donut shows', () => {
    expect(outcomesSummary(OVERVIEW.actionItems)).toBe(
      'Of 20 action items: 9 done, 8 still open and 3 overdue.',
    );
  });

  it('names who finished the largest share, breaking ties by how much they finished', () => {
    expect(completionSummary(MEMBERS, OVERVIEW.tasks)).toBe(
      'Grace Hopper finished the largest share of their tasks: 3 of 4 (75%). Across the team: 6 of 10 tasks (60%).',
    );
    const tied = [
      member({ name: 'Few', tasksAssigned: 1, tasksCompleted: 1, completionRate: 1 }),
      member({ name: 'Many', tasksAssigned: 3, tasksCompleted: 3, completionRate: 1 }),
    ];
    expect(completionSummary(tied, undefined)).toBe(
      'Many finished the largest share of their tasks: 3 of 3 (100%).',
    );
    expect(completionSummary([member({ name: 'Idle' })], undefined)).toBe(
      'Nobody was given a task in this period.',
    );
  });

  it('names the most active member and what they did', () => {
    expect(activitySummary(MEMBERS)).toBe(
      'Grace Hopper was the most active: 8 meetings attended, 6 action items owned and 3 tasks completed.',
    );
    expect(activitySummary([])).toBe(
      'Nobody took part in a meeting or finished a task in this period.',
    );
  });
});
