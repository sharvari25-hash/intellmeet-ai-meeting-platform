import {
  toCsv,
  type AnalyticsDataset,
  type AnalyticsMembers,
  type AnalyticsWeekly,
} from '@intellmeet/shared';
import type { AnalyticsScope } from './analytics.scope.js';

/**
 * The CSV exports: the same numbers the dashboard's tables show, one row per
 * week or per person. Every cell goes through `toCsv`, which quotes text and
 * defuses anything a spreadsheet would run as a formula - member names are
 * typed by the members themselves.
 */

export function weeklyCsv(data: AnalyticsWeekly): string {
  return toCsv([
    [
      'Week starting',
      'Meetings',
      'Meeting minutes',
      'Average minutes',
      'Average participants',
      'Action items raised',
      'Action items completed',
    ],
    ...data.weeks.map((week) => [
      week.week,
      week.meetings,
      week.totalMinutes,
      week.averageMinutes,
      week.averageParticipants,
      week.actionItemsCreated,
      week.actionItemsCompleted,
    ]),
  ]);
}

export function membersCsv(data: AnalyticsMembers): string {
  return toCsv([
    [
      'Member',
      'Current member',
      'Meetings attended',
      'Meetings hosted',
      'Minutes in meetings',
      'Chat messages',
      'Action items owned',
      'Action items completed',
      'Tasks assigned',
      'Tasks completed',
      'Task completion %',
      'Activity',
    ],
    ...data.members.map((member) => [
      member.name,
      member.isMember ? 'yes' : 'no',
      member.meetingsAttended,
      member.meetingsHosted,
      member.minutesInMeetings,
      member.messagesSent,
      member.actionItemsOwned,
      member.actionItemsCompleted,
      member.tasksAssigned,
      member.tasksCompleted,
      member.completionRate === null ? null : Math.round(member.completionRate * 100),
      member.activity,
    ]),
  ]);
}

/**
 * `intellmeet-<team slug>-<dataset>-<from>-to-<to>.csv`. Built only from the
 * slug (lower-case letters, digits and hyphens) and validated dates, so
 * nothing a user typed reaches the header.
 */
export function exportFileName(scope: AnalyticsScope, dataset: AnalyticsDataset): string {
  const slug = scope.teamSlug.replace(/[^a-z0-9-]/g, '') || 'team';
  return `intellmeet-${slug}-${dataset}-${scope.from}-to-${scope.to}.csv`;
}
