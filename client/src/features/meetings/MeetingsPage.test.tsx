import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { MeetingListItem } from '@intellmeet/shared';
import { authPayload, renderWithProviders } from '@/test/utils';
import { meeting } from '@/test/meetingFixtures';
import { useAuthStore } from '@/stores/authStore';
import { MeetingsPage } from './MeetingsPage';

const TEAM = {
  id: '507f1f77bcf86cd799439012',
  name: 'IntellMeet Demo Team',
  slug: 'intellmeet-demo',
  ownerId: '507f1f77bcf86cd799439013',
  members: [],
  myRole: 'member',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function row(id: string, overrides: Partial<MeetingListItem> = {}): MeetingListItem {
  return {
    ...meeting({ id: id.padStart(24, 'a') }),
    preview: {
      summary: 'The team held a retrospective on the Q3 pricing launch.',
      keyDecisionCount: 3,
      actionItemCount: 4,
      openActionItemCount: 3,
    },
    match: null,
    ...overrides,
  };
}

const RETRO = row('1', { title: 'Q3 launch retrospective' });
const SPRINT = row('2', {
  title: 'Sprint 14 planning',
  preview: {
    summary: 'The team reviewed sprint 13.',
    keyDecisionCount: 2,
    actionItemCount: 4,
    openActionItemCount: 4,
  },
});

/**
 * A fake `GET /api/meetings`: the rows for each query string, and the teams.
 * Records every list request so a test can check what was asked for.
 */
function serve(
  answer: (params: URLSearchParams) => { meetings: MeetingListItem[]; total: number },
  teams = [TEAM],
) {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: 't',
  });
  const requests: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/teams') return Response.json({ teams });
    requests.push(parsed.searchParams);
    const { meetings, total } = answer(parsed.searchParams);
    return Response.json({
      meetings,
      total,
      page: Number(parsed.searchParams.get('page') ?? 1),
      limit: 10,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

/** Shows the router's current search string, so tests can see URL state. */
function Location() {
  return <output aria-label="URL">{useLocation().search}</output>;
}

function renderPage(search = '') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/meetings"
        element={
          <>
            <MeetingsPage />
            <Location />
          </>
        }
      />
    </Routes>,
    { route: `/app/meetings${search}` },
  );
}

describe('<MeetingsPage />', () => {
  it('lists meetings with the start of each summary and what it produced', async () => {
    serve(() => ({ meetings: [RETRO, SPRINT], total: 2 }));
    renderPage();

    expect(
      await screen.findByRole(
        'heading',
        { level: 3, name: 'Q3 launch retrospective' },
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('2 meetings')).toBeInTheDocument();
    expect(screen.getByText('The team reviewed sprint 13.')).toBeInTheDocument();
    expect(screen.getAllByText('4 action items, 3 open')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Sprint 14 planning' })).toHaveAttribute(
      'href',
      `/app/meetings/${SPRINT.id}`,
    );
  });

  it('searches once typing pauses, and shows why each meeting matched', async () => {
    const requests = serve((params) =>
      params.get('q') === 'pricing'
        ? {
            meetings: [
              row('1', {
                title: 'Q3 launch retrospective',
                match: {
                  source: 'summary',
                  snippet: 'The team held a retrospective on the Q3 pricing launch.',
                  offsetSec: null,
                },
              }),
            ],
            total: 1,
          }
        : { meetings: [RETRO, SPRINT], total: 2 },
    );
    const { user } = renderPage();
    await screen.findByText('2 meetings');

    await user.type(screen.getByRole('searchbox', { name: 'Search meetings' }), 'pricing');

    expect(await screen.findByText('1 meeting matching “pricing”')).toBeInTheDocument();
    // One request for the finished word, not one per keystroke.
    expect(requests.filter((params) => params.has('q')).map((p) => p.get('q'))).toEqual([
      'pricing',
    ]);
    expect(screen.getByLabelText('URL')).toHaveTextContent('?q=pricing');

    const result = screen.getByRole('article');
    expect(within(result).getByText('Summary')).toBeInTheDocument();
    expect(within(result).getByText('pricing', { selector: 'mark' })).toBeInTheDocument();
  });

  it('links a transcript match straight to that moment', async () => {
    serve(() => ({
      meetings: [
        row('3', {
          title: 'Design review',
          match: {
            source: 'transcript',
            snippet: 'Grace Hopper: From the interviews last month...',
            offsetSec: 30,
          },
        }),
      ],
      total: 1,
    }));
    renderPage('?q=interviews');

    const jump = await screen.findByRole('link', {
      name: 'Open the transcript of Design review at 00:30',
    });
    expect(jump).toHaveAttribute(
      'href',
      `/app/meetings/${'3'.padStart(24, 'a')}?tab=transcript&t=30&q=interviews`,
    );
    // Restored from the URL, so a shared or reloaded search still shows its words.
    expect(screen.getByRole('searchbox', { name: 'Search meetings' })).toHaveValue('interviews');
  });

  it('filters by status, and says so when a filter is empty', async () => {
    const requests = serve((params) =>
      params.get('status') === 'scheduled'
        ? { meetings: [], total: 0 }
        : { meetings: [RETRO], total: 1 },
    );
    const { user } = renderPage();
    await screen.findByText('1 meeting');

    await user.click(screen.getByRole('button', { name: 'Upcoming' }));

    expect(
      await screen.findByText('Nothing scheduled. Schedule a meeting and it appears here.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upcoming' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(requests.at(-1)?.get('status')).toBe('scheduled');
    expect(screen.getByLabelText('URL')).toHaveTextContent('?status=upcoming');
  });

  it('offers to clear a search that found nothing', async () => {
    serve((params) =>
      params.get('q') ? { meetings: [], total: 0 } : { meetings: [RETRO], total: 1 },
    );
    const { user } = renderPage('?q=zeppelin');

    expect(await screen.findByText('Nothing matches “zeppelin”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear the search' }));

    expect(await screen.findByText('1 meeting')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search meetings' })).toHaveValue('');
  });

  it('pages through long histories', async () => {
    const requests = serve(() => ({ meetings: [RETRO], total: 25 }));
    const { user } = renderPage();

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(requests.at(-1)?.get('page')).toBe('2');
  });

  it('only shows a team picker to someone in more than one team', async () => {
    serve(
      () => ({ meetings: [RETRO], total: 1 }),
      [TEAM, { ...TEAM, id: 'b'.repeat(24), name: 'Platform' }],
    );
    renderPage();

    const picker = await screen.findByRole('combobox', { name: 'Team' });
    expect(within(picker).getByRole('option', { name: 'Platform' })).toBeInTheDocument();
  });

  it('shows no team picker for a single team', async () => {
    serve(() => ({ meetings: [RETRO], total: 1 }));
    renderPage();

    await screen.findByText('1 meeting');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Team' })).toBeNull());
  });
});
