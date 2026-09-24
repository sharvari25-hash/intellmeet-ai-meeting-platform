import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { apiErrorBody, renderWithProviders } from '@/test/utils';
import { GRACE_ID, MEETING_ID, lastInsightPatch, serveMeeting } from '@/test/meetingFixtures';
import { MeetingDetailPage } from './MeetingDetailPage';

/** The host correcting the AI output. */

function renderPage(search = '') {
  return renderWithProviders(<MeetingDetailPage />, {
    route: `/app/meetings/${MEETING_ID}${search}`,
    path: '/app/meetings/:meetingId',
  });
}

describe('editing the summary', () => {
  it('saves a corrected summary and decisions, then says it was edited', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Edit summary' }, { timeout: 5_000 }),
    );

    const summary = screen.getByRole('textbox', { name: 'Summary' });
    await user.clear(summary);
    await user.type(summary, 'The team planned sprint 14 and froze scope.');

    await user.click(screen.getByRole('button', { name: 'Add a decision' }));
    await user.type(screen.getByLabelText('Decision 2'), 'Scope freezes on Wednesdays');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('The team planned sprint 14 and froze scope.'),
    ).toBeInTheDocument();
    expect(lastInsightPatch(fetchMock)).toEqual({
      summary: 'The team planned sprint 14 and froze scope.',
      keyDecisions: ['Build Google Calendar only this sprint', 'Scope freezes on Wednesdays'],
    });
    expect(screen.getByText(/Edited by Demo User/)).toBeInTheDocument();
  });

  it('drops a decision whose text was emptied, and refuses an empty summary', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit summary' }));
    await user.clear(screen.getByRole('textbox', { name: 'Summary' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('The summary cannot be empty')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/insight'))).toBe(false);

    await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Short.');
    await user.clear(screen.getByLabelText('Decision 1'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(lastInsightPatch(fetchMock).keyDecisions).toEqual([]));
  });

  it('keeps the form open and says why when saving fails', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Edit summary' }));
    fetchMock.mockImplementationOnce(async () =>
      Response.json(apiErrorBody('CONFLICT', 'The summary is still being generated.'), {
        status: 409,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('still being generated');
    expect(screen.getByRole('textbox', { name: 'Summary' })).toBeInTheDocument();
  });
});

describe('editing action items', () => {
  it('ticks an item off in one click', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage('?tab=actions');

    await user.click(
      await screen.findByRole('checkbox', { name: 'Done: Fix the upload retry bug' }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'Done: Fix the upload retry bug' }),
      ).toBeChecked(),
    );
    const sent = lastInsightPatch(fetchMock).actionItems ?? [];
    expect(sent.map((item) => [item.id, item.status])).toEqual([
      ['a1', 'done'],
      ['a2', 'open'],
    ]);
    expect(screen.getByRole('tab', { name: /Action items/ })).toHaveTextContent('1 open');
  });

  it('reassigns, dates and adds items, keeping the ids of the ones that existed', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage('?tab=actions');

    await user.click(await screen.findByRole('button', { name: 'Edit action items' }));

    // The name the AI heard is still an option, so it is not silently lost...
    const owner = screen.getByLabelText('Owner of action item 2');
    expect(
      within(owner).getByRole('option', { name: 'Sam (not a participant)' }),
    ).toBeInTheDocument();
    // ...but the host can hand the item to somebody who was actually there.
    await user.selectOptions(owner, 'Grace Hopper');
    await user.type(screen.getByLabelText('Due date of action item 2'), '2026-10-01');

    await user.click(screen.getByRole('button', { name: 'Add an action item' }));
    await user.type(screen.getByLabelText('Action item 3'), 'Book the retro');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByText('Book the retro')).toBeInTheDocument());
    expect(lastInsightPatch(fetchMock).actionItems).toEqual([
      {
        id: 'a1',
        text: 'Fix the upload retry bug',
        assigneeId: GRACE_ID,
        assigneeName: null,
        dueDate: '2026-09-18',
        status: 'open',
      },
      {
        id: 'a2',
        text: 'Call the vendor',
        assigneeId: GRACE_ID,
        assigneeName: null,
        dueDate: '2026-10-01',
        status: 'open',
      },
      {
        text: 'Book the retro',
        assigneeId: null,
        assigneeName: null,
        dueDate: null,
        status: 'open',
      },
    ]);
  });

  it('refuses to save an item with no text', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage('?tab=actions');

    await user.click(await screen.findByRole('button', { name: 'Edit action items' }));
    await user.clear(screen.getByLabelText('Action item 1'));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Describe the action item')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/insight'))).toBe(false);
  });

  it('removes an item', async () => {
    const fetchMock = serveMeeting();
    const { user } = renderPage('?tab=actions');

    await user.click(await screen.findByRole('button', { name: 'Edit action items' }));
    await user.click(screen.getByRole('button', { name: 'Remove action item 2' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(lastInsightPatch(fetchMock).actionItems?.map((item) => item.id)).toEqual(['a1']),
    );
  });
});
