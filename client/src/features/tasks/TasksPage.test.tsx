import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { SOCKET_EVENTS, type MoveTaskInput, type UpdateTaskInput } from '@intellmeet/shared';
import { useSocketStore } from '@/stores/socketStore';
import {
  COLUMNS,
  GRACE_ID,
  PERSONA_ID,
  SELF_ID,
  lastBody,
  serveBoard,
  task,
} from '@/test/boardFixtures';
import { renderWithProviders } from '@/test/utils';
import { TasksPage } from './TasksPage';

function renderPage(search = '') {
  return renderWithProviders(<TasksPage />, { route: `/app/tasks${search}`, path: '/app/tasks' });
}

const column = (name: string) => screen.getByRole('region', { name });

function fakeSocket() {
  return { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
}

afterEach(() => {
  act(() => useSocketStore.setState({ socket: null }));
});

describe('<TasksPage /> board', () => {
  it('shows the team board in its columns, with overdue work flagged', async () => {
    serveBoard({
      tasks: [
        task({ title: 'Write the release notes' }),
        task({ title: 'Fix the upload bug', columnId: COLUMNS.doing, dueDate: '2020-01-06' }),
        task({ title: 'Old but finished', columnId: COLUMNS.done, dueDate: '2020-01-06' }),
      ],
    });
    renderPage();

    expect(
      await screen.findByRole('region', { name: 'To Do' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(
      within(column('To Do')).getByRole('button', { name: 'Write the release notes' }),
    ).toBeInTheDocument();
    expect(within(column('In Progress')).getByText(/Overdue/)).toBeInTheDocument();
    // A task in a "done" column is finished, so it cannot be overdue.
    expect(within(column('Done')).queryByText(/Overdue/)).not.toBeInTheDocument();
    // Each card has its own keyboard-accessible drag handle.
    expect(screen.getByRole('button', { name: 'Move Fix the upload bug' })).toBeInTheDocument();
  });

  it('adds a task to a column from the column itself', async () => {
    const fetchMock = serveBoard({ tasks: [] });
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add a task to Review' }));
    await user.type(
      screen.getByRole('textbox', { name: 'New task in Review' }),
      'Check the contrast{Enter}',
    );

    expect(lastBody(fetchMock, 'POST', '/tasks')).toEqual({
      title: 'Check the contrast',
      columnId: COLUMNS.review,
    });
    expect(
      await within(column('Review')).findByRole('button', { name: 'Check the contrast' }),
    ).toBeInTheDocument();
  });

  it('opens a task, edits it and saves', async () => {
    const notes = task({ title: 'Write the release notes' });
    const fetchMock = serveBoard({ tasks: [notes] });
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Write the release notes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Write the release notes' });

    const title = within(dialog).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'Write the 1.4 release notes');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Assignee' }),
      'Grace Hopper',
    );
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Priority' }), 'High');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(lastBody<UpdateTaskInput>(fetchMock, 'PATCH', `/tasks/${notes.id}`)).toMatchObject({
        title: 'Write the 1.4 release notes',
        assigneeId: GRACE_ID,
        priority: 'high',
        dueDate: null,
      }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Write the 1.4 release notes' }),
    ).toBeInTheDocument();
  });

  it('shows a sample task read-only to a member, who can still move it', async () => {
    const sample = task({ title: 'A sample task', seeded: true, createdBy: PERSONA_ID });
    const shipped = task({ title: 'Shipped', columnId: COLUMNS.done });
    const fetchMock = serveBoard({ tasks: [sample, shipped] });
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'A sample task' }));
    const dialog = await screen.findByRole('dialog', { name: 'A sample task' });

    expect(
      within(dialog).getByText(/only a team admin can change or delete it/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument();

    // The column picker is the keyboard way to move: to the bottom of Done,
    // after what is already there.
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Column' }), 'Done');
    await waitFor(() =>
      expect(lastBody<MoveTaskInput>(fetchMock, 'POST', `/tasks/${sample.id}/move`)).toEqual({
        columnId: COLUMNS.done,
        afterId: shipped.id,
        beforeId: null,
      }),
    );
    expect(within(dialog).getByRole('combobox', { name: 'Column' })).toHaveValue(COLUMNS.done);
  });

  it('lets the creator delete their own task after confirming', async () => {
    const mine = task({ title: 'Mine' });
    const fetchMock = serveBoard({ tasks: [mine] });
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Mine' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mine' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }));
    expect(fetchMock).not.toHaveBeenCalledWith(
      `/api/tasks/${mine.id}`,
      expect.objectContaining({ method: 'DELETE' }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Mine' })).not.toBeInTheDocument();
  });

  it('offers column options to a team admin only', async () => {
    serveBoard({ tasks: [], role: 'member' });
    const member = renderPage();
    await screen.findByRole('region', { name: 'To Do' });
    expect(
      screen.queryByRole('button', { name: 'Options for the To Do column' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a column' })).not.toBeInTheDocument();
    member.unmount();

    serveBoard({ tasks: [], role: 'admin' });
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Options for the To Do column' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a column' })).toBeInTheDocument();
  });

  it('applies another window’s changes live, and never an older copy over a newer one', async () => {
    const socket = fakeSocket();
    act(() => useSocketStore.setState({ socket: socket as never }));
    const card = task({ title: 'Book the venue', version: 3 });
    serveBoard({ tasks: [card] });
    renderPage();
    await screen.findByRole('button', { name: 'Book the venue' });

    // Watching this board.
    expect(socket.emit).toHaveBeenCalledWith(SOCKET_EVENTS.BOARD_JOIN, { boardId: card.boardId });
    const handler = (event: string) =>
      socket.on.mock.calls.find(([name]) => name === event)?.[1] as (payload: unknown) => void;
    // React Query tells the page on the next tick, so let one pass.
    const deliver = (event: string, payload: unknown) =>
      act(async () => {
        handler(event)(payload);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

    // Somebody else moved it to Done.
    await deliver(SOCKET_EVENTS.TASK_MOVED, {
      boardId: card.boardId,
      task: { ...card, columnId: COLUMNS.done, version: 4 },
      reordered: [],
    });
    expect(
      within(column('Done')).getByRole('button', { name: 'Book the venue' }),
    ).toBeInTheDocument();

    // A late copy of an earlier state arrives: ignored.
    await deliver(SOCKET_EVENTS.TASK_UPDATED, {
      boardId: card.boardId,
      task: { ...card, columnId: COLUMNS.todo, version: 3 },
    });
    expect(
      within(column('Done')).getByRole('button', { name: 'Book the venue' }),
    ).toBeInTheDocument();

    // And a task created in the other window appears.
    await deliver(SOCKET_EVENTS.TASK_CREATED, {
      boardId: card.boardId,
      task: task({ title: 'From the other window', columnId: COLUMNS.review }),
    });
    expect(
      within(column('Review')).getByRole('button', { name: 'From the other window' }),
    ).toBeInTheDocument();

    // Another board's events are not this one's business.
    await deliver(SOCKET_EVENTS.TASK_DELETED, { boardId: 'a'.repeat(24), taskId: card.id });
    expect(
      within(column('Done')).getByRole('button', { name: 'Book the venue' }),
    ).toBeInTheDocument();
  });
});

describe('<TasksPage /> my tasks', () => {
  it('lists my tasks, overdue first, done last', async () => {
    const mine = (title: string, extra: object) => ({
      ...task({ title, assigneeId: SELF_ID, assigneeName: 'Ada Lovelace' }),
      boardName: 'Product board',
      teamName: 'IntellMeet Demo Team',
      columnTitle: 'To Do',
      isDone: false,
      ...extra,
    });
    serveBoard({
      tasks: [],
      mine: [
        mine('Due later', { dueDate: '2999-01-01' }),
        mine('Late', { dueDate: '2020-01-06' }),
        mine('Finished', { isDone: true, columnTitle: 'Done', dueDate: '2020-01-06' }),
        mine('Whenever', { dueDate: null }),
      ],
    });
    renderPage('?view=mine');

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Overdue(1)',
      'Coming up(1)',
      'No due date(1)',
      'Done(1)',
    ]);
    expect(screen.getByText(/Overdue, was due/)).toBeInTheDocument();
  });
});
