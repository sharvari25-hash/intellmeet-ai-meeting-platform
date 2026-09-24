import { describe, expect, it } from 'vitest';
import { findMentionSpans, findMentions, type Mentionable } from '@intellmeet/shared';

/**
 * The mention parser is shared: the server notifies exactly the people the
 * client highlights, so its rules are pinned down here.
 */

const ada = { id: 'ada', name: 'Ada Lovelace' };
const adam = { id: 'adam', name: 'Adam Smith' };
const grace = { id: 'grace', name: 'Grace Hopper' };
const amberOtter = { id: 'otter', name: 'Amber Otter' };
const amberHeron = { id: 'heron', name: 'Amber Heron' };
const team: Mentionable[] = [ada, adam, grace];

const ids = (text: string, people = team) => findMentions(text, people).map((p) => p.id);

describe('findMentions', () => {
  it('finds a full name, in any case', () => {
    expect(ids('@Ada Lovelace can you check?')).toEqual(['ada']);
    expect(ids('thanks @grace hopper!')).toEqual(['grace']);
  });

  it('finds a first name that nobody else shares', () => {
    expect(ids('@Grace can you check?')).toEqual(['grace']);
    expect(ids('@ada and @adam, both of you')).toEqual(['ada', 'adam']);
  });

  it('does not find "@Ada" inside "@Adam"', () => {
    expect(ids('@Adam will do it')).toEqual(['adam']);
  });

  it('mentions nobody for a first name two people share, rather than guessing', () => {
    expect(ids('@Amber can you take it?', [amberOtter, amberHeron])).toEqual([]);
    expect(ids('@Amber Heron can you take it?', [amberOtter, amberHeron])).toEqual(['heron']);
  });

  it('ignores an email address and a bare @', () => {
    expect(ids('mail ada@example.com or grace@example.com')).toEqual([]);
    expect(ids('meet @ 3pm')).toEqual([]);
  });

  it('allows punctuation straight after a name', () => {
    expect(ids('Over to you, @Grace.')).toEqual(['grace']);
    expect(ids("@Ada's notes")).toEqual(['ada']);
  });

  it('lists each person once, in order of first mention', () => {
    expect(ids('@Grace then @Ada then @Grace again')).toEqual(['grace', 'ada']);
  });

  it('reports where each mention is, for highlighting', () => {
    const text = 'Thanks @Ada Lovelace and @grace!';
    const spans = findMentionSpans(text, team);

    expect(spans.map((span) => text.slice(span.start, span.end))).toEqual([
      '@Ada Lovelace',
      '@grace',
    ]);
  });
});
