import type {
  AnalyticsMember,
  AnalyticsMembers,
  AnalyticsOverview,
  AnalyticsRange,
  AnalyticsWeek,
  AnalyticsWeekly,
} from '@intellmeet/shared';

/** Analytics responses shaped exactly like the API's, for page tests. */

export const RANGE: AnalyticsRange = {
  teamId: '507f1f77bcf86cd799439012',
  teamName: 'IntellMeet Demo Team',
  from: '2026-09-07',
  to: '2026-09-27',
  tz: 'UTC',
  weeks: ['2026-09-07', '2026-09-14', '2026-09-21'],
};

export function week(overrides: Partial<AnalyticsWeek> & { week: string }): AnalyticsWeek {
  return {
    meetings: 0,
    totalMinutes: 0,
    averageMinutes: null,
    averageParticipants: null,
    actionItemsCreated: 0,
    actionItemsCompleted: 0,
    ...overrides,
  };
}

export const WEEKS: AnalyticsWeek[] = [
  week({
    week: '2026-09-07',
    meetings: 3,
    totalMinutes: 106,
    averageMinutes: 35.3,
    averageParticipants: 3.3,
    actionItemsCreated: 7,
    actionItemsCompleted: 6,
  }),
  week({
    week: '2026-09-14',
    meetings: 4,
    totalMinutes: 139,
    averageMinutes: 34.8,
    averageParticipants: 3.5,
    actionItemsCreated: 9,
    actionItemsCompleted: 3,
  }),
  week({
    week: '2026-09-21',
    meetings: 1,
    totalMinutes: 21,
    averageMinutes: 21,
    averageParticipants: 4,
    actionItemsCreated: 4,
    actionItemsCompleted: 0,
  }),
];

export const OVERVIEW: AnalyticsOverview = {
  range: RANGE,
  meetings: { count: 8, totalMinutes: 266, averageMinutes: 33.3, averageParticipants: 3.5 },
  actionItems: { created: 20, completed: 9, open: 8, overdue: 3 },
  tasks: { created: 10, completed: 6, completionRate: 0.6 },
  generatedAt: '2026-09-24T10:42:00.000Z',
};

export function member(overrides: Partial<AnalyticsMember> & { name: string }): AnalyticsMember {
  return {
    userId: overrides.name.length.toString(16).padStart(24, '0'),
    isMember: true,
    meetingsAttended: 0,
    meetingsHosted: 0,
    minutesInMeetings: 0,
    messagesSent: 0,
    actionItemsOwned: 0,
    actionItemsCompleted: 0,
    tasksAssigned: 0,
    tasksCompleted: 0,
    completionRate: null,
    activity: 0,
    ...overrides,
  };
}

export const MEMBERS: AnalyticsMember[] = [
  member({
    userId: 'a'.repeat(24),
    name: 'Grace Hopper',
    meetingsAttended: 8,
    meetingsHosted: 2,
    minutesInMeetings: 250,
    messagesSent: 5,
    actionItemsOwned: 6,
    actionItemsCompleted: 4,
    tasksAssigned: 4,
    tasksCompleted: 3,
    completionRate: 0.75,
    activity: 17,
  }),
  member({
    userId: 'b'.repeat(24),
    name: 'Alan Turing',
    meetingsAttended: 7,
    meetingsHosted: 1,
    minutesInMeetings: 230,
    actionItemsOwned: 5,
    actionItemsCompleted: 2,
    tasksAssigned: 5,
    tasksCompleted: 2,
    completionRate: 0.4,
    activity: 14,
  }),
  member({
    userId: 'c'.repeat(24),
    name: 'Cy Former',
    isMember: false,
    meetingsAttended: 1,
    minutesInMeetings: 10,
    activity: 1,
  }),
];

export const WEEKLY: AnalyticsWeekly = {
  range: RANGE,
  weeks: WEEKS,
  generatedAt: OVERVIEW.generatedAt,
};
export const MEMBERS_RESPONSE: AnalyticsMembers = {
  range: RANGE,
  members: MEMBERS,
  generatedAt: OVERVIEW.generatedAt,
};
