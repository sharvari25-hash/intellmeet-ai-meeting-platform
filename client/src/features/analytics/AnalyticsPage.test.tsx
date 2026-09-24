import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { rangeForWeeks, todayIn } from '@intellmeet/shared';
import { authPayload, renderWithProviders } from '@/test/utils';
import { MEMBERS_RESPONSE, OVERVIEW, WEEKLY, member } from '@/test/analyticsFixtures';
import { saveBlob } from '@/lib/download';
import { useAuthStore } from '@/stores/authStore';
import { AnalyticsPage } from './AnalyticsPage';
import { weekOf } from './format';
import { browserTimeZone } from './useAnalyticsFilters';

/*
 * jsdom lays nothing out, so a ResponsiveContainer would measure 0 x 0 and
 * draw nothing. A fixed size lets the real chart code render its SVG, which
 * is what these tests smoke-test; the assertions are on what people read:
 * the summaries and the tables.
 */
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
            width: 640,
            height: 240,
          })
        : null,
  };
});

vi.mock('@/lib/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/download')>()),
  saveBlob: vi.fn(),
}));

const TEAM = {
  id: '507f1f77bcf86cd799439012',
  name: 'IntellMeet Demo Team',
  slug: 'intellmeet-demo',
  ownerId: '507f1f77bcf86cd799439013',
  members: [],
  myRole: 'member',
  createdAt: '2026-09-01T00:00:00.000Z',
};
const OWN_TEAM = {
  ...TEAM,
  id: '507f1f77bcf86cd799439099',
  name: 'My own team',
  createdAt: '2026-09-20T00:00:00.000Z',
};

interface Served {
  requests: URL[];
}

/** A fake API: teams, the three aggregations, and the CSV export. */
function serve(
  options: {
    teams?: (typeof TEAM)[];
    members?: typeof MEMBERS_RESPONSE;
    fail?: boolean;
  } = {},
): Served {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as never,
    accessToken: 't',
  });
  const served: Served = { requests: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.pathname === '/api/teams')
        return Response.json({ teams: options.teams ?? [TEAM] });
      served.requests.push(parsed);
      if (options.fail) {
        return Response.json(
          { error: { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' } },
          { status: 500 },
        );
      }
      switch (parsed.pathname) {
        case '/api/analytics/overview':
          return Response.json(OVERVIEW);
        case '/api/analytics/weekly':
          return Response.json(WEEKLY);
        case '/api/analytics/members':
          return Response.json(options.members ?? MEMBERS_RESPONSE);
        case '/api/analytics/export':
          return new Response('\uFEFF"Member"\r\n', {
            headers: {
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition':
                'attachment; filename="intellmeet-intellmeet-demo-members.csv"',
            },
          });
        default:
          return new Response(null, { status: 404 });
      }
    }),
  );
  return served;
}

function Location() {
  return <output aria-label="URL">{useLocation().search}</output>;
}

function renderPage(search = '') {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/analytics"
        element={
          <>
            <AnalyticsPage />
            <Location />
          </>
        }
      />
    </Routes>,
    { route: `/app/analytics${search}` },
  );
}

const card = (name: string) => screen.getByRole('region', { name });

describe('<AnalyticsPage />', () => {
  it('opens on the last eight weeks of the team, in the reader’s time zone', async () => {
    const served = serve();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Meetings per week' })).toBeInTheDocument();
    const tz = browserTimeZone();
    const expected = rangeForWeeks(8, todayIn(tz));
    const overview = served.requests.find((url) => url.pathname.endsWith('/overview'));
    expect(Object.fromEntries(overview?.searchParams ?? [])).toEqual({
      teamId: TEAM.id,
      ...expected,
      tz,
    });
    expect(screen.getByRole('button', { name: '8 weeks' })).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText(/Meeting time, attendance and follow-through for IntellMeet Demo Team/),
    ).toBeInTheDocument();
  });

  it('leads with the headline numbers', async () => {
    serve();
    renderPage();

    const meetings = (await screen.findByText('Meetings', { selector: 'dt' })).parentElement;
    expect(meetings).toHaveTextContent('8');
    expect(meetings).toHaveTextContent('in 3 weeks');
    expect(
      screen.getByText('Time in meetings', { selector: 'dt' }).parentElement,
    ).toHaveTextContent('4.4 h');
    expect(screen.getByText('Attendance', { selector: 'dt' }).parentElement).toHaveTextContent(
      '3.5',
    );
    expect(
      screen.getByText('Action items done', { selector: 'dt' }).parentElement,
    ).toHaveTextContent('45%9 of 20, 3 overdue');
    expect(screen.getByText('Tasks completed', { selector: 'dt' }).parentElement).toHaveTextContent(
      '60%6 of 10 tasks created',
    );
  });

  it('gives every chart a summary sentence and a table with its numbers', async () => {
    serve();
    renderPage();
    await screen.findByRole('heading', { name: 'Meetings per week' });

    const meetings = card('Meetings per week');
    expect(meetings).toHaveAccessibleDescription(
      `8 meetings over 3 weeks, 2.7 a week on average. Busiest: ${weekOf('2026-09-14')} (4). Quietest: ${weekOf('2026-09-21')} (1).`,
    );
    // The table is there for screen readers even while the chart shows...
    const table = within(meetings).getByRole('table', { name: 'Meetings per week' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toHaveLength(3);
    // ...and the chart itself is drawn, but hidden from assistive technology.
    const chart = meetings.querySelector('[data-slot="chart"]');
    expect(chart).toHaveAttribute('aria-hidden', 'true');
    expect(chart?.querySelector('svg')).not.toBeNull();

    expect(card('Action items: raised and done')).toHaveAccessibleDescription(
      /^9 of 20 action items raised in this period are done \(45%\)\. Of the 4 items from the week of .+, none are done so far\.$/,
    );
    expect(card('What became of the action items')).toHaveAccessibleDescription(
      'Of 20 action items: 9 done, 8 still open and 3 overdue.',
    );
    expect(card('Task completion by member')).toHaveAccessibleDescription(
      'Grace Hopper finished the largest share of their tasks: 3 of 4 (75%). Across the team: 6 of 10 tasks (60%).',
    );
    expect(card('Most active members')).toHaveAccessibleDescription(
      'Grace Hopper was the most active: 8 meetings attended, 6 action items owned and 3 tasks completed.',
    );

    // Someone who has left is still counted, and labelled.
    const activity = within(card('Most active members')).getByRole('table');
    expect(
      within(activity).getByRole('rowheader', { name: 'Cy Former (left the team)' }),
    ).toBeInTheDocument();
  });

  it('swaps a chart for its table on screen, and back', async () => {
    serve();
    const { user } = renderPage();
    await screen.findByRole('heading', { name: 'Meetings per week' });
    const meetings = card('Meetings per week');
    const chart = meetings.querySelector('[data-slot="chart"]');

    await user.click(
      within(meetings).getByRole('button', { name: 'Show table for Meetings per week' }),
    );
    expect(chart).toHaveClass('hidden');
    // Now a scrollable region a keyboard can reach.
    const region = within(meetings).getByRole('region', { name: 'Meetings per week, table' });
    expect(region).toHaveAttribute('tabindex', '0');

    await user.click(
      within(meetings).getByRole('button', { name: 'Show chart for Meetings per week' }),
    );
    expect(chart).not.toHaveClass('hidden');
    expect(within(meetings).queryByRole('region', { name: 'Meetings per week, table' })).toBeNull();
  });

  it('keeps the period in the URL: presets, and any dates', async () => {
    const served = serve();
    const { user } = renderPage();
    await screen.findByRole('heading', { name: 'Meetings per week' });

    await user.click(screen.getByRole('button', { name: '4 weeks' }));
    await waitFor(() => expect(screen.getByLabelText('URL')).toHaveTextContent('?weeks=4'));
    const expected = rangeForWeeks(4, todayIn(browserTimeZone()));
    await waitFor(() =>
      expect(served.requests.some((url) => url.searchParams.get('from') === expected.from)).toBe(
        true,
      ),
    );

    // A date picker's "change": the whole date at once.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } });
    await waitFor(() =>
      expect(screen.getByLabelText('URL')).toHaveTextContent(`from=2026-06-01&to=${expected.to}`),
    );
    expect(screen.getByRole('button', { name: '4 weeks' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('explains a range it cannot show, and does not ask for it', async () => {
    const served = serve();
    renderPage('?from=2026-09-10&to=2026-09-01');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start date is after the end date.',
    );
    expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true');
    expect(served.requests).toEqual([]);
  });

  it('opens on the team you have been in longest, and lets you switch', async () => {
    const served = serve({ teams: [OWN_TEAM, TEAM] });
    const { user } = renderPage();
    await screen.findByRole('heading', { name: 'Meetings per week' });

    const picker = screen.getByLabelText('Team');
    expect(picker).toHaveValue(TEAM.id);
    await user.selectOptions(picker, OWN_TEAM.id);
    await waitFor(() =>
      expect(served.requests.some((url) => url.searchParams.get('teamId') === OWN_TEAM.id)).toBe(
        true,
      ),
    );
    expect(screen.getByLabelText('URL')).toHaveTextContent(`team=${OWN_TEAM.id}`);
  });

  it('exports the table on screen as a CSV file', async () => {
    const served = serve();
    const { user } = renderPage('?weeks=12');
    await screen.findByRole('heading', { name: 'Meetings per week' });

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Members (.csv)' }));

    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    const exported = served.requests.find((url) => url.pathname === '/api/analytics/export');
    expect(exported?.searchParams.get('dataset')).toBe('members');
    expect(exported?.searchParams.get('from')).toBe(
      rangeForWeeks(12, todayIn(browserTimeZone())).from,
    );
    expect(vi.mocked(saveBlob).mock.calls[0]?.[1]).toBe('intellmeet-intellmeet-demo-members.csv');
  });

  it('says so when there is nothing to chart yet', async () => {
    serve({ members: { ...MEMBERS_RESPONSE, members: [member({ name: 'Idle', activity: 0 })] } });
    renderPage();
    await screen.findByRole('heading', { name: 'Meetings per week' });

    expect(
      within(card('Task completion by member')).getByText(
        'Nobody was given a task in this period.',
        { selector: 'p:not([id])' },
      ),
    ).toBeInTheDocument();
    expect(within(card('Most active members')).queryByRole('table')).toBeNull();
  });

  it('offers to try again when the numbers cannot be loaded', async () => {
    serve({ fail: true });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the analytics.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks someone with no team to join one', async () => {
    serve({ teams: [] });
    renderPage();
    expect(
      await screen.findByText('Join or create a team to see its analytics.'),
    ).toBeInTheDocument();
  });
});
