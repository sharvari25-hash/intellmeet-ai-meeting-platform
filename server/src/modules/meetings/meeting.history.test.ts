import { describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  meetingListSchema,
  searchTerms,
  stem,
  termPattern,
  type MeetingListItem,
} from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { bearer, createTeam, registerUser, type TestUser } from '../../test/fixtures.js';
import { seedDemoMeetings } from '../demo/demo.meetings.js';
import { Team } from '../teams/team.model.js';
import { User } from '../users/user.model.js';
import { excerpt, shorten } from './meeting.history.js';

const app = createApp();

/**
 * A team holding the three sample meetings, seen by "Demo User" - who hosts
 * them in the fixtures - exactly as a seeded demo workspace is.
 */
async function seededHistory(): Promise<{ viewer: TestUser; teamId: string }> {
  const viewer = await registerUser(app, { name: 'Demo User' });
  const teamId = await createTeam(app, viewer, 'History');

  const mates = await Promise.all(
    ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'].map((name, index) =>
      User.create({ name, email: `mate-${index}@example.com`, passwordHash: 'x' }),
    ),
  );
  await Team.updateOne(
    { _id: teamId },
    {
      $push: {
        members: { $each: mates.map((mate) => ({ userId: mate._id, role: 'member' })) },
      },
    },
  );

  await seedDemoMeetings({
    teamId,
    people: [
      { id: viewer.id, name: viewer.name },
      ...mates.map((mate) => ({ id: mate._id.toString(), name: mate.name })),
    ],
  });

  return { viewer, teamId };
}

async function list(user: TestUser, query: string) {
  const response = await request(app)
    .get(`/api/meetings?${query}`)
    .set('Authorization', bearer(user))
    .expect(200);

  // The response is the shared contract, previews and matches included.
  return meetingListSchema.parse(response.body);
}

const titles = (rows: MeetingListItem[]) => rows.map((row) => row.title);

describe('meeting history', () => {
  it('lists past meetings most recently ended first, each with a summary preview', async () => {
    const { viewer } = await seededHistory();

    const { meetings, total } = await list(viewer, 'status=ended');

    expect(total).toBe(3);
    const ended = meetings.map((row) => new Date(row.endedAt ?? 0).getTime());
    expect(ended).toEqual([...ended].sort((a, b) => b - a));

    const sprint = meetings.find((row) => row.title === 'Sprint 14 planning');
    expect(sprint?.preview).toMatchObject({
      keyDecisionCount: 2,
      actionItemCount: 4,
      openActionItemCount: 4,
    });
    expect(sprint?.preview?.summary).toMatch(/^The team reviewed sprint 13/);
    // A list row, not the whole summary.
    expect(sprint?.preview?.summary.length).toBeLessThanOrEqual(240);
    expect(sprint?.match).toBeNull();
  });

  it('orders upcoming meetings soonest first', async () => {
    const viewer = await registerUser(app);
    const teamId = await createTeam(app, viewer);
    const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

    for (const [title, days] of [
      ['Later', 9],
      ['Soonest', 1],
      ['Middle', 4],
    ] as const) {
      await request(app)
        .post('/api/meetings')
        .set('Authorization', bearer(viewer))
        .send({ teamId, title, scheduledAt: inDays(days) })
        .expect(201);
    }

    const { meetings } = await list(viewer, 'status=scheduled');

    expect(titles(meetings)).toEqual(['Soonest', 'Middle', 'Later']);
    expect(meetings.every((row) => row.preview === null)).toBe(true);
  });
});

describe('meeting history search', () => {
  it('finds a meeting by what its summary says, and quotes the sentence', async () => {
    const { viewer } = await seededHistory();

    const { meetings, total } = await list(viewer, 'q=pricing');

    expect(total).toBe(1);
    expect(meetings[0]?.title).toBe('Q3 launch retrospective');
    expect(meetings[0]?.match).toEqual({
      source: 'summary',
      snippet: 'The team held a retrospective on the Q3 pricing launch.',
      offsetSec: null,
    });
  });

  it('finds words only ever spoken, and says where in the recording', async () => {
    const { viewer } = await seededHistory();

    const { meetings } = await list(viewer, 'q=interviews');

    expect(titles(meetings)).toEqual(['Design review: meeting summary page']);
    expect(meetings[0]?.match?.source).toBe('transcript');
    expect(meetings[0]?.match?.offsetSec).toBe(30);
    expect(meetings[0]?.match?.snippet).toMatch(/^Grace Hopper: From the interviews last month/);
  });

  it('ranks a title match above a passing mention, and pages through the rest', async () => {
    const { viewer } = await seededHistory();

    // "planning" is in one title; the retro transcript says "we planned" -
    // the same word to Mongo's stemmer, and to the highlighter.
    const first = await list(viewer, 'q=planning&limit=1&page=1');
    const second = await list(viewer, 'q=planning&limit=1&page=2');

    expect(first.total).toBe(2);
    expect(titles(first.meetings)).toEqual(['Sprint 14 planning']);
    // The title is on screen already, so the row quotes where it was *said*.
    expect(first.meetings[0]?.match).toMatchObject({
      source: 'transcript',
      snippet: 'Grace Hopper: Can we freeze scope after planning?',
    });

    expect(titles(second.meetings)).toEqual(['Q3 launch retrospective']);
    expect(second.meetings[0]?.match?.snippet).toContain('exactly what we planned');
  });

  it('combines the search with the status filter', async () => {
    const { viewer } = await seededHistory();

    expect((await list(viewer, 'q=pricing&status=ended')).total).toBe(1);
    expect((await list(viewer, 'q=pricing&status=live')).total).toBe(0);
  });

  it('never searches another team’s meetings, in either direction', async () => {
    const { viewer } = await seededHistory();

    const outsider = await registerUser(app);
    const theirTeam = await createTeam(app, outsider, 'Elsewhere');
    await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(outsider))
      .send({ teamId: theirTeam, title: 'Pricing review' })
      .expect(201);

    expect(titles((await list(viewer, 'q=pricing')).meetings)).toEqual(['Q3 launch retrospective']);
    expect(titles((await list(outsider, 'q=pricing')).meetings)).toEqual(['Pricing review']);
  });

  it('falls back to the title when that is the only place the words are', async () => {
    const { viewer, teamId } = await seededHistory();
    await request(app)
      .post('/api/meetings')
      .set('Authorization', bearer(viewer))
      .send({ teamId, title: 'Quarterly budget review' })
      .expect(201);

    const { meetings } = await list(viewer, 'q=budget');

    expect(titles(meetings)).toEqual(['Quarterly budget review']);
    expect(meetings[0]?.match).toEqual({
      source: 'title',
      snippet: 'Quarterly budget review',
      offsetSec: null,
    });
  });

  it('answers an unmatched search with an empty page, not an error', async () => {
    const { viewer } = await seededHistory();

    expect(await list(viewer, 'q=zeppelin')).toMatchObject({ total: 0, meetings: [] });
  });
});

describe('seeded chat', () => {
  it('gives each sample meeting a chat log at the right moments', async () => {
    const { viewer } = await seededHistory();
    const { meetings } = await list(viewer, 'q=sprint');
    const sprint = meetings.find((row) => row.title === 'Sprint 14 planning');
    if (!sprint?.startedAt) throw new Error('The sprint planning sample is missing');

    const response = await request(app)
      .get(`/api/meetings/${sprint.id}/messages`)
      .set('Authorization', bearer(viewer))
      .expect(200);

    const messages = response.body.messages as { senderName: string; createdAt: string }[];
    expect(messages).toHaveLength(5);
    expect(messages[0]?.senderName).toBe('Ada Lovelace');
    // Backdated onto the meeting's own clock, 18s in, not "now".
    expect(new Date(messages[0]?.createdAt ?? 0).getTime()).toBe(
      new Date(sprint.startedAt).getTime() + 18_000,
    );
  });

  it('does not duplicate the chat when the seed runs again', async () => {
    const { viewer, teamId } = await seededHistory();
    const people = [{ id: viewer.id, name: 'Demo User' }];
    await seedDemoMeetings({ teamId, people });

    const { meetings } = await list(viewer, 'q=sprint');
    const response = await request(app)
      .get(`/api/meetings/${meetings[0]?.id}/messages`)
      .set('Authorization', bearer(viewer));

    // Re-seeded with only the host known, so only the host's line survives -
    // but nothing is doubled.
    expect(response.body.messages).toHaveLength(1);
  });
});

describe('search terms', () => {
  it('reduces a word to what its inflections share', () => {
    expect(stem('planning')).toBe('plan');
    expect(stem('plans')).toBe('plan');
    expect(stem('decisions')).toBe('decision');
    // Too short to strip "es" from without matching "not", "nothing"...
    expect(stem('notes')).toBe('note');
    expect(stem('q3')).toBe('q3');
  });

  it('reads a query the way Mongo does: phrases split, exclusions dropped', () => {
    expect(searchTerms('"Billing migration" -pricing a Q3!')).toEqual([
      'billing',
      'migration',
      'q3',
    ]);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('matches whole words that start with a stem, and nothing inside a word', () => {
    const pattern = termPattern(searchTerms('planning'));
    if (!pattern) throw new Error('Expected a pattern');

    expect('We planned it. Plan B. Planning.'.match(pattern)).toEqual([
      'planned',
      'Plan',
      'Planning',
    ]);
    expect('explain the airplane'.match(pattern)).toBeNull();
    expect(termPattern([])).toBeNull();
  });
});

describe('snippets', () => {
  const pattern = () => {
    const built = termPattern(['calendar']);
    if (!built) throw new Error('Expected a pattern');
    return built;
  };

  it('quotes the sentence containing the match', () => {
    const text = 'First sentence. The Google Calendar spike is due Wednesday. Last one.';

    expect(excerpt(text, pattern())).toBe('The Google Calendar spike is due Wednesday.');
    expect(excerpt('Nothing relevant here.', pattern())).toBeNull();
  });

  it('windows a long sentence around the match rather than cutting it off', () => {
    const long = `${'word '.repeat(80)}the calendar work slipped ${'again '.repeat(80)}`;

    const snippet = excerpt(long, pattern(), 120) ?? '';

    expect(snippet).toContain('calendar');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(122);
  });

  it('shortens on a word boundary', () => {
    expect(shorten('one two three four', 11)).toBe('one two…');
    expect(shorten('short', 11)).toBe('short');
  });
});
