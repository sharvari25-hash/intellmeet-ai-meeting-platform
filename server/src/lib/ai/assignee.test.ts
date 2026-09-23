import { describe, expect, it } from 'vitest';
import { levenshtein, matchAssignee, nameScore, normalizeName } from './assignee.js';

const PEOPLE = [
  { id: '1', name: 'Ada Lovelace' },
  { id: '2', name: 'Grace Hopper' },
  { id: '3', name: 'Alan Turing' },
  { id: '4', name: 'Demo User' },
];

const match = (spoken: string | null) => matchAssignee(spoken, PEOPLE)?.name ?? null;

describe('matchAssignee', () => {
  it.each([
    ['Grace Hopper', 'Grace Hopper'],
    ['grace hopper', 'Grace Hopper'],
    ['Grace', 'Grace Hopper'],
    ['Hopper', 'Grace Hopper'],
    ['Grace H.', 'Grace Hopper'],
    ['Dr. Hopper', 'Grace Hopper'],
    ['Alan T', 'Alan Turing'],
  ])('matches "%s" to %s', (spoken, expected) => {
    expect(match(spoken)).toBe(expected);
  });

  it('forgives a transcription slip', () => {
    expect(match('Grase')).toBe('Grace Hopper');
    expect(match('Alan Turning')).toBe('Alan Turing');
  });

  it('ignores accents and case', () => {
    expect(matchAssignee('ÁDA', PEOPLE)?.id).toBe('1');
  });

  it('returns nobody for a name that is not in the meeting', () => {
    expect(match('Sam')).toBeNull();
    expect(match('Grace Kelly')).toBeNull();
  });

  it('returns nobody rather than guessing between two equally good matches', () => {
    // A wrong owner puts a task on somebody else's board; no owner lets the
    // host choose.
    const twoAlexes = [
      { id: 'a', name: 'Alex Smith' },
      { id: 'b', name: 'Alex Jones' },
    ];

    expect(matchAssignee('Alex', twoAlexes)).toBeNull();
    expect(matchAssignee('Alex Jones', twoAlexes)?.id).toBe('b');
  });

  it('handles no name at all', () => {
    expect(match(null)).toBeNull();
    expect(match('   ')).toBeNull();
  });
});

describe('helpers', () => {
  it('normalises honorifics and punctuation away', () => {
    expect(normalizeName('Dr. Grace  Hopper-Smith')).toEqual(['grace', 'hopper', 'smith']);
  });

  it('computes edit distance', () => {
    expect(levenshtein('grace', 'grase')).toBe(1);
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('same', 'same')).toBe(0);
  });

  it('scores one bad token as a bad match overall', () => {
    expect(nameScore('Grace Hopper', 'Grace Hopper')).toBe(1);
    expect(nameScore('Grace Kelly', 'Grace Hopper')).toBeLessThan(0.75);
  });
});
