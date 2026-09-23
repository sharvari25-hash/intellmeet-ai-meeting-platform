import { describe, expect, it } from 'vitest';
import {
  heuristicAnalysis,
  MockProvider,
  resolveDueDate,
  scriptedMeeting,
} from './mock.provider.js';

const MONDAY = new Date('2026-09-14T09:30:00Z');
const PEOPLE = ['Demo User', 'Ada Lovelace', 'Grace Hopper'];

describe('MockProvider', () => {
  it('is deterministic', async () => {
    const provider = new MockProvider();
    const audio = {
      data: Buffer.alloc(0),
      mimeType: 'audio/webm',
      filename: 'a.webm',
      context: { title: 'Sync', participantNames: PEOPLE, meetingDate: MONDAY },
    };

    expect(await provider.transcribe(audio)).toEqual(await provider.transcribe(audio));
  });

  it("writes the script with the meeting's real participants", () => {
    const speakers = new Set(scriptedMeeting('Sync', PEOPLE).map((segment) => segment.speaker));
    expect(speakers).toEqual(new Set(PEOPLE));
  });

  it('finds the decisions and owners in its own script', () => {
    const analysis = heuristicAnalysis({
      title: 'Sync',
      participantNames: PEOPLE,
      meetingDate: MONDAY,
      segments: scriptedMeeting('Sync', PEOPLE),
    });

    expect(analysis.keyDecisions).toHaveLength(2);
    expect(analysis.actionItems).toEqual([
      {
        text: 'Write the release notes for the onboarding changes by Friday',
        assigneeName: 'Ada Lovelace',
        dueDate: '2026-09-18',
      },
      // Asked of Grace, then accepted by her: one task, with the date from the reply.
      {
        text: 'Pair with the backend team on the export timeout',
        assigneeName: 'Grace Hopper',
        dueDate: '2026-09-15',
      },
    ]);
  });
});

describe('resolveDueDate', () => {
  it.each([
    ['by Friday', '2026-09-18'],
    ['on Monday', '2026-09-21'], // never "today"
    ['tomorrow', '2026-09-15'],
    ['today', '2026-09-14'],
    ['by end of week', '2026-09-18'],
    ['next week', '2026-09-21'],
    ['by 2026-10-01', '2026-10-01'],
  ])('reads "%s" as %s', (phrase, expected) => {
    expect(resolveDueDate(`I will do it ${phrase}.`, MONDAY)).toBe(expected);
  });

  it('returns null when no deadline was stated', () => {
    expect(resolveDueDate('I will look into it.', MONDAY)).toBeNull();
  });
});
