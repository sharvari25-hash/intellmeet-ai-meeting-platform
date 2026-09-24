import type { Types } from 'mongoose';
import { addDays } from '@intellmeet/shared';
import { stableObjectId } from '../../lib/ids.js';

/**
 * Eight weeks of the demo team's history: the meetings that make the
 * analytics dashboard worth looking at.
 *
 * The three detailed sample meetings (`server/fixtures/`) are the last week
 * or so. These are the seven or eight weeks before, kept deliberately short -
 * a two-sentence summary, the decisions, the owned action items - but never
 * empty: each one reads like a real team's minutes in the history, opens to a
 * summary and a short transcript, and some of their action items became tasks
 * that were finished on the board.
 *
 * Positions are relative, not dates: `weeksAgo` counts back from the week the
 * seed runs in (Monday-based, UTC), so the history always ends last week. The
 * housekeeping sweep moves it forward a week at a time (`refreshDemoHistory`),
 * which keeps "the last eight weeks" full however long ago the seed ran.
 *
 * Words the end-to-end suite searches for in the sample meetings ("pricing",
 * "interviews") are kept out of these, and fewer than ten of them mention a
 * sprint, so those searches still find what they look for on the first page.
 */

type Person = 'Demo User' | 'Ada Lovelace' | 'Grace Hopper' | 'Alan Turing';

const EVERYONE: Person[] = ['Demo User', 'Ada Lovelace', 'Grace Hopper', 'Alan Turing'];

export interface HistoryActionItem {
  /** Imperative, as the AI writes them: "Update the checklist". */
  text: string;
  owner: Person;
  /** Due this many days after the meeting; null for no deadline. */
  dueInDays: number | null;
  /**
   * What became of it:
   * - `done`: ticked off on the meeting page;
   * - `task`: made into a task, which is now in the board's Done column;
   * - `open`: nothing yet (so a reviewer can still turn it into a task).
   */
  outcome: 'done' | 'task' | 'open';
}

export interface HistoryMeeting {
  /** Stable identity: the meeting's `seedKey` is `history-<key>`. */
  key: string;
  title: string;
  /** 1 is last week. */
  weeksAgo: number;
  /** 0 is Monday. */
  weekday: number;
  /** Start time, UTC (`HH:MM`): mid-morning in Europe, afternoon in India. */
  startUtc: string;
  minutes: number;
  host: Person;
  /** Who joined, host first. */
  attendees: Person[];
  /** The host's opening line, the first line of the transcript. */
  opening: string;
  summary: string;
  decisions: string[];
  actionItems: HistoryActionItem[];
}

export const HISTORY_MEETINGS: readonly HistoryMeeting[] = [
  // --- Last week -------------------------------------------------------------
  {
    key: 'w1-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 1,
    weekday: 1,
    startUtc: '08:30',
    minutes: 27,
    host: 'Demo User',
    attendees: EVERYONE,
    opening: 'Morning, everyone. Board feedback first, then the Contoso follow-up.',
    summary:
      'Early board users want to turn meeting action items into tasks without retyping them. The Contoso pilot starts next month.',
    decisions: ['Action items become tasks in one click'],
    actionItems: [
      {
        text: 'Design the create-task-from-action-item flow',
        owner: 'Alan Turing',
        dueInDays: 10,
        outcome: 'open',
      },
      {
        text: 'Set up the Contoso pilot workspace',
        owner: 'Grace Hopper',
        dueInDays: 5,
        outcome: 'done',
      },
      {
        text: 'Draft the pilot success criteria',
        owner: 'Demo User',
        dueInDays: 12,
        outcome: 'open',
      },
    ],
  },
  {
    key: 'w1-critique-mobile-board',
    title: 'Design critique: the board on a phone',
    weeksAgo: 1,
    weekday: 2,
    startUtc: '10:00',
    minutes: 36,
    host: 'Alan Turing',
    attendees: ['Alan Turing', 'Ada Lovelace', 'Grace Hopper', 'Demo User'],
    opening: 'The board on a phone is up on the screen. Have a look.',
    summary:
      'On phones the board scrolls sideways one column at a time. Dragging needs a long press, so that a swipe still scrolls.',
    decisions: ['A long press starts a drag on touch screens'],
    actionItems: [
      {
        text: 'Add the long-press drag on touch screens',
        owner: 'Alan Turing',
        dueInDays: 5,
        outcome: 'task',
      },
      {
        text: 'Test the board on the low-end phones',
        owner: 'Grace Hopper',
        dueInDays: 7,
        outcome: 'open',
      },
    ],
  },

  // --- Two weeks ago ---------------------------------------------------------
  {
    key: 'w2-sprint-13-planning',
    title: 'Sprint 13 planning',
    weeksAgo: 2,
    weekday: 0,
    startUtc: '09:30',
    minutes: 62,
    host: 'Ada Lovelace',
    attendees: ['Ada Lovelace', 'Demo User', 'Grace Hopper', 'Alan Turing'],
    opening: 'Sprint 13: the first version of the task board, and summaries in search.',
    summary:
      'Sprint 13 builds the first version of the task board and adds summaries to search. Drag and drop has to work from the keyboard from day one.',
    decisions: [
      'Keyboard drag and drop ships with the first version',
      'Summaries join the search this sprint',
    ],
    actionItems: [
      {
        text: 'Build keyboard drag and drop for the board',
        owner: 'Alan Turing',
        dueInDays: 7,
        outcome: 'task',
      },
      {
        text: 'Add summaries to the search index',
        owner: 'Ada Lovelace',
        dueInDays: 6,
        outcome: 'done',
      },
      {
        text: 'Write acceptance tests for the board',
        owner: 'Grace Hopper',
        dueInDays: 5,
        outcome: 'task',
      },
    ],
  },
  {
    key: 'w2-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 2,
    weekday: 1,
    startUtc: '08:30',
    minutes: 21,
    host: 'Demo User',
    attendees: ['Demo User', 'Grace Hopper', 'Alan Turing'],
    opening: 'Morning. Ada is at the conference, so a short one today.',
    summary:
      'The board prototype is in review. The conference booth needs a demo account that tidies itself up every day.',
    decisions: ['The booth demo account resets itself every night'],
    actionItems: [
      {
        text: 'Prepare the conference demo account',
        owner: 'Demo User',
        dueInDays: 4,
        outcome: 'done',
      },
      {
        text: 'Print the one-page product sheet',
        owner: 'Grace Hopper',
        dueInDays: 3,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w2-contoso-debrief',
    title: 'Customer call debrief: Contoso',
    weeksAgo: 2,
    weekday: 3,
    startUtc: '11:00',
    minutes: 23,
    host: 'Grace Hopper',
    attendees: ['Grace Hopper', 'Demo User', 'Ada Lovelace'],
    opening: 'Quick debrief from the Contoso call.',
    summary:
      'Contoso wants action items to become tasks after every meeting. They also asked for a weekly report of meeting hours per team.',
    decisions: ['Meeting analytics goes on the roadmap'],
    actionItems: [
      {
        text: 'Send Contoso the roadmap summary',
        owner: 'Grace Hopper',
        dueInDays: 2,
        outcome: 'done',
      },
      {
        text: 'Sketch the meeting analytics dashboard',
        owner: 'Demo User',
        dueInDays: 20,
        outcome: 'open',
      },
    ],
  },

  // --- Three weeks ago -------------------------------------------------------
  {
    key: 'w3-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 3,
    weekday: 1,
    startUtc: '08:30',
    minutes: 26,
    host: 'Demo User',
    attendees: EVERYONE,
    opening: 'Morning. The search demo first, then the support queue.',
    summary:
      'Title search works on the history page and answers in under 50 ms. Two support tickets asked for searching inside summaries.',
    decisions: ['Summaries become searchable next'],
    actionItems: [
      {
        text: 'Collect example searches from the support tickets',
        owner: 'Grace Hopper',
        dueInDays: 4,
        outcome: 'done',
      },
      {
        text: 'Measure search speed with ten thousand meetings',
        owner: 'Ada Lovelace',
        dueInDays: 6,
        outcome: 'open',
      },
    ],
  },
  {
    key: 'w3-critique-board',
    title: 'Design critique: task board',
    weeksAgo: 3,
    weekday: 2,
    startUtc: '10:00',
    minutes: 38,
    host: 'Alan Turing',
    attendees: ['Alan Turing', 'Ada Lovelace', 'Grace Hopper'],
    opening: 'The board mocks, four columns. Tear them apart.',
    summary:
      'The board keeps four columns, and cards show only the owner, due date and priority. An overdue card gets a label rather than turning red.',
    decisions: [
      'Cards show the owner, due date and priority only',
      'Overdue is a label, not a red card',
    ],
    actionItems: [
      {
        text: 'Mock the card with the overdue label',
        owner: 'Alan Turing',
        dueInDays: 3,
        outcome: 'task',
      },
      {
        text: 'Check the board with a screen reader',
        owner: 'Grace Hopper',
        dueInDays: 5,
        outcome: 'open',
      },
    ],
  },
  {
    key: 'w3-incident-review',
    title: 'Incident review: failed recording uploads',
    weeksAgo: 3,
    weekday: 3,
    startUtc: '12:00',
    minutes: 31,
    host: 'Ada Lovelace',
    attendees: ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'],
    opening: 'Incident review. Uploads failed for about an hour on Tuesday.',
    summary:
      'For about an hour, recordings from people on slow connections failed to upload and were not retried. Nothing was lost for good, but three hosts had to record again.',
    decisions: ['Failed uploads must retry before the host is told'],
    actionItems: [
      {
        text: 'Write up the upload incident timeline',
        owner: 'Ada Lovelace',
        dueInDays: 2,
        outcome: 'done',
      },
      {
        text: 'Reproduce the failure on a throttled connection',
        owner: 'Grace Hopper',
        dueInDays: 4,
        outcome: 'open',
      },
      {
        text: 'Add an alert when uploads fail twice in a row',
        owner: 'Alan Turing',
        dueInDays: 7,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w3-sprint-12-retro',
    title: 'Sprint 12 retro',
    weeksAgo: 3,
    weekday: 4,
    startUtc: '14:00',
    minutes: 44,
    host: 'Ada Lovelace',
    attendees: EVERYONE,
    opening: 'Sprint 12 retro. Let us go around the table.',
    summary:
      'The mobile layout finally shipped, and support tickets about phones stopped. Title search is live. Estimates were too optimistic again.',
    decisions: ['Size stories with the whole team, not only the owner'],
    actionItems: [
      {
        text: 'Run the next estimation session with everyone',
        owner: 'Ada Lovelace',
        dueInDays: 3,
        outcome: 'done',
      },
      {
        text: 'Write the release notes for title search',
        owner: 'Demo User',
        dueInDays: 2,
        outcome: 'task',
      },
    ],
  },

  // --- Four weeks ago --------------------------------------------------------
  {
    key: 'w4-sprint-12-planning',
    title: 'Sprint 12 planning',
    weeksAgo: 4,
    weekday: 0,
    startUtc: '09:30',
    minutes: 70,
    host: 'Ada Lovelace',
    attendees: EVERYONE,
    opening: 'Sprint 12: finish the mobile layout and start on search.',
    summary:
      'Sprint 12 finishes the mobile layout and starts meeting search. Search covers titles first; transcripts come later.',
    decisions: [
      'Search covers titles first, transcripts later',
      'The mobile layout must work at 360 pixels',
    ],
    actionItems: [
      {
        text: 'Finish the mobile meeting room controls',
        owner: 'Alan Turing',
        dueInDays: 6,
        outcome: 'task',
      },
      {
        text: 'Prototype title search on the history page',
        owner: 'Ada Lovelace',
        dueInDays: 8,
        outcome: 'task',
      },
      {
        text: 'Write test cases for the 360 pixel layout',
        owner: 'Grace Hopper',
        dueInDays: 4,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w4-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 4,
    weekday: 1,
    startUtc: '08:30',
    minutes: 24,
    host: 'Demo User',
    attendees: EVERYONE,
    opening: 'Morning. A quick round on search and support.',
    summary:
      'Support volume fell by a third after the invite link change. Search needs an index on meeting titles before it can go live.',
    decisions: [],
    actionItems: [
      {
        text: 'Add a text index on meeting titles',
        owner: 'Ada Lovelace',
        dueInDays: 3,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w4-security-review',
    title: 'Security review: session handling',
    weeksAgo: 4,
    weekday: 3,
    startUtc: '13:00',
    minutes: 42,
    host: 'Ada Lovelace',
    attendees: ['Ada Lovelace', 'Alan Turing', 'Demo User'],
    opening: 'Security review. Sessions and refresh tokens today.',
    summary:
      'Refresh tokens are rotated, but a stolen one could be replayed for its whole lifetime. The team will add reuse detection and shorten access tokens to fifteen minutes.',
    decisions: ['Add refresh token reuse detection', 'Access tokens last fifteen minutes'],
    actionItems: [
      {
        text: 'Implement refresh token reuse detection',
        owner: 'Ada Lovelace',
        dueInDays: 7,
        outcome: 'task',
      },
      {
        text: 'Document the session model for the security page',
        owner: 'Demo User',
        dueInDays: 10,
        outcome: 'open',
      },
    ],
  },

  // --- Five weeks ago: a public holiday, and half the team away ------------
  {
    key: 'w5-sprint-11-retro',
    title: 'Sprint 11 retro',
    weeksAgo: 5,
    weekday: 4,
    startUtc: '14:00',
    minutes: 40,
    host: 'Ada Lovelace',
    attendees: EVERYONE,
    opening: 'Sprint 11 retro. Wins first, then the rest.',
    summary:
      'Emails shipped on the job queue without an incident. The mobile layout slipped: real phones found far more than the emulator did.',
    decisions: ['Test on real phones before calling a screen done'],
    actionItems: [
      { text: 'Buy two low-end test phones', owner: 'Demo User', dueInDays: 7, outcome: 'done' },
      {
        text: 'Move the mobile layout stories into the next plan',
        owner: 'Ada Lovelace',
        dueInDays: 1,
        outcome: 'done',
      },
    ],
  },

  // --- Six weeks ago ---------------------------------------------------------
  {
    key: 'w6-sprint-11-planning',
    title: 'Sprint 11 planning',
    weeksAgo: 6,
    weekday: 0,
    startUtc: '09:30',
    minutes: 58,
    host: 'Ada Lovelace',
    attendees: EVERYONE,
    opening: 'Sprint 11: notification emails and the mobile layout.',
    summary:
      'Sprint 11 covers notification emails and a first pass at a mobile layout. Emails move to a queue, so a slow provider never holds up a request.',
    decisions: [
      'Send notification emails from a queue',
      'The mobile layout starts with the meeting room',
    ],
    actionItems: [
      {
        text: 'Move email sending onto the job queue',
        owner: 'Alan Turing',
        dueInDays: 5,
        outcome: 'task',
      },
      {
        text: 'Draft the notification email templates',
        owner: 'Grace Hopper',
        dueInDays: 4,
        outcome: 'done',
      },
      {
        text: 'List the screens that break below 400 pixels',
        owner: 'Demo User',
        dueInDays: 2,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w6-critique-emails',
    title: 'Design critique: notification emails',
    weeksAgo: 6,
    weekday: 2,
    startUtc: '10:00',
    minutes: 32,
    host: 'Alan Turing',
    attendees: ['Alan Turing', 'Grace Hopper', 'Demo User'],
    opening: 'The email templates are up on the screen.',
    summary:
      'Each template was trimmed to a single call to action. The weekly digest was cut from this release.',
    decisions: ['One call to action per email', 'No weekly digest in this release'],
    actionItems: [
      {
        text: 'Cut each email template down to one button',
        owner: 'Grace Hopper',
        dueInDays: 3,
        outcome: 'task',
      },
      {
        text: 'Add a plain-text version of every email',
        owner: 'Alan Turing',
        dueInDays: 5,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w6-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 6,
    weekday: 1,
    startUtc: '08:30',
    minutes: 28,
    host: 'Demo User',
    attendees: EVERYONE,
    opening: 'Morning. Mostly the mobile layout today.',
    summary:
      'The meeting room is hard to use on small phones: the controls overflow and the chat covers the video. Grace will test on her own phone every day.',
    decisions: [],
    actionItems: [
      {
        text: 'Test the meeting room on a small phone every day',
        owner: 'Grace Hopper',
        dueInDays: 5,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w6-northwind-debrief',
    title: 'Customer call debrief: Northwind',
    weeksAgo: 6,
    weekday: 3,
    startUtc: '11:00',
    minutes: 18,
    host: 'Grace Hopper',
    attendees: ['Grace Hopper', 'Demo User'],
    opening: 'Debrief from the Northwind call.',
    summary:
      'Northwind runs twelve stand-ups a day and wants the summaries posted to their chat tool. They would pilot the task board if tasks could come straight from a summary.',
    decisions: ['Offer Northwind a pilot of the task board'],
    actionItems: [
      { text: 'Send Northwind the pilot plan', owner: 'Demo User', dueInDays: 2, outcome: 'task' },
      {
        text: 'Write up the chat integration request',
        owner: 'Grace Hopper',
        dueInDays: 5,
        outcome: 'done',
      },
    ],
  },

  // --- Seven weeks ago -------------------------------------------------------
  {
    key: 'w7-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 7,
    weekday: 1,
    startUtc: '08:30',
    minutes: 22,
    host: 'Demo User',
    attendees: ['Demo User', 'Ada Lovelace', 'Grace Hopper'],
    opening: 'Morning. Alan is out today, so let us keep it short.',
    summary:
      'Onboarding completion rose from 54% to 61% in its first week. Two customers asked for single sign-on; nobody is committing to it yet.',
    decisions: ['Single sign-on goes on the roadmap as research'],
    actionItems: [
      {
        text: 'Collect the single sign-on requests in one document',
        owner: 'Demo User',
        dueInDays: 5,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w7-critique-onboarding',
    title: 'Design critique: onboarding checklist',
    weeksAgo: 7,
    weekday: 2,
    startUtc: '10:00',
    minutes: 35,
    host: 'Alan Turing',
    attendees: ['Alan Turing', 'Ada Lovelace', 'Demo User'],
    opening: 'Let us look at the onboarding checklist mocks.',
    summary:
      'The checklist shrank to three steps: create a team, invite someone, hold a first meeting. The progress ring was dropped as noise.',
    decisions: ['The onboarding checklist has three steps', 'Drop the progress ring'],
    actionItems: [
      {
        text: 'Update the checklist mock to three steps',
        owner: 'Alan Turing',
        dueInDays: 2,
        outcome: 'done',
      },
      {
        text: 'Check the checklist colours for contrast',
        owner: 'Ada Lovelace',
        dueInDays: 3,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w7-sprint-10-retro',
    title: 'Sprint 10 retro',
    weeksAgo: 7,
    weekday: 4,
    startUtc: '14:00',
    minutes: 45,
    host: 'Ada Lovelace',
    attendees: EVERYONE,
    opening: 'Sprint 10 retro. What went well, and what did not.',
    summary:
      'Onboarding shipped a day late because its analytics events were added last. Everyone liked pairing on the empty states and wants to keep it.',
    decisions: ['Instrument new features while building them, not after'],
    actionItems: [
      {
        text: 'Add an analytics checklist to the pull request template',
        owner: 'Alan Turing',
        dueInDays: 4,
        outcome: 'done',
      },
      {
        text: 'Book a pairing slot every fortnight',
        owner: 'Ada Lovelace',
        dueInDays: 3,
        outcome: 'done',
      },
    ],
  },

  // --- Eight weeks ago -------------------------------------------------------
  {
    key: 'w8-sprint-10-planning',
    title: 'Sprint 10 planning',
    weeksAgo: 8,
    weekday: 0,
    startUtc: '09:30',
    minutes: 65,
    host: 'Ada Lovelace',
    attendees: EVERYONE,
    opening: 'Morning all. Sprint 10 is about getting onboarding out of beta.',
    summary:
      'Sprint 10 set out to take the onboarding flow out of beta. The team sized eleven stories and held the calendar work back until onboarding ships.',
    decisions: [
      'Onboarding leaves beta at the end of this sprint',
      'Calendar integration waits until onboarding ships',
    ],
    actionItems: [
      {
        text: 'Write the empty-state copy for the first dashboard visit',
        owner: 'Grace Hopper',
        dueInDays: 4,
        outcome: 'task',
      },
      {
        text: 'Add analytics events to each onboarding step',
        owner: 'Alan Turing',
        dueInDays: 7,
        outcome: 'done',
      },
      {
        text: 'Book the onboarding walkthrough with support',
        owner: 'Demo User',
        dueInDays: 3,
        outcome: 'done',
      },
    ],
  },
  {
    key: 'w8-product-sync',
    title: 'Weekly product sync',
    weeksAgo: 8,
    weekday: 1,
    startUtc: '08:30',
    minutes: 25,
    host: 'Demo User',
    attendees: EVERYONE,
    opening: 'A quick one today: onboarding status and the support queue.',
    summary:
      'The support queue is down to nine open tickets, most about invite links expiring too soon. Onboarding is on track.',
    decisions: ['Invite links last seven days instead of two'],
    actionItems: [
      {
        text: 'Change the invite link expiry to seven days',
        owner: 'Ada Lovelace',
        dueInDays: 2,
        outcome: 'task',
      },
      {
        text: 'Reply to the invite link tickets with the new expiry',
        owner: 'Grace Hopper',
        dueInDays: 3,
        outcome: 'done',
      },
    ],
  },
];

// --- Dates ---------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monday 00:00 UTC of the week `now` falls in: the point the whole history
 * is placed relative to. It changes once a week, which is when the sweep
 * moves the history forward.
 */
export function historyAnchor(now: Date): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekday = (new Date(midnight).getUTCDay() + 6) % 7;
  return new Date(midnight - weekday * DAY_MS);
}

/** When a history meeting started and ended, for a seed run at `now`. */
export function historyTimes(
  meeting: HistoryMeeting,
  now: Date,
): { startedAt: Date; endedAt: Date } {
  const [hours = 0, minutes = 0] = meeting.startUtc.split(':').map(Number);
  const day = historyAnchor(now).getTime() + (meeting.weekday - 7 * meeting.weeksAgo) * DAY_MS;
  const startedAt = new Date(day + (hours * 60 + minutes) * 60 * 1000);
  return { startedAt, endedAt: new Date(startedAt.getTime() + meeting.minutes * 60 * 1000) };
}

/** An action item's due date (`YYYY-MM-DD`), counted from the meeting's day. */
export function historyDueDate(
  meeting: HistoryMeeting,
  item: HistoryActionItem,
  now: Date,
): string | null {
  if (item.dueInDays === null) return null;
  const day = historyTimes(meeting, now).startedAt.toISOString().slice(0, 10);
  return addDays(day, item.dueInDays);
}

/** The id of a history meeting's action item: stable across seeds, like the samples'. */
export function historyActionItemId(meetingKey: string, index: number): Types.ObjectId {
  return stableObjectId(`history:${meetingKey}:action:${index}`);
}

/** What every history meeting's `seedKey` starts with. */
export const HISTORY_PREFIX = 'history-';

/** The `seedKey` of a history meeting. */
export function historySeedKey(meeting: Pick<HistoryMeeting, 'key'>): string {
  return `${HISTORY_PREFIX}${meeting.key}`;
}

/** Items that became tasks, newest meeting first: the order they sit in "Done". */
export function historyTasks(): {
  meeting: HistoryMeeting;
  item: HistoryActionItem;
  index: number;
}[] {
  return [...HISTORY_MEETINGS]
    .sort((a, b) => a.weeksAgo - b.weeksAgo || b.weekday - a.weekday)
    .flatMap((meeting) =>
      meeting.actionItems.flatMap((item, index) =>
        item.outcome === 'task' ? [{ meeting, item, index }] : [],
      ),
    );
}
