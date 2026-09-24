import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { CreateTasksFromActionItemsInput, MeetingIntelligence } from '@intellmeet/shared';
import { BOARD_ID, SELF_ID, task as boardTask } from '@/test/boardFixtures';
import {
  GRACE_ID,
  HOST_ID,
  MEETING_ID,
  intelligence,
  meeting,
  serveMeeting,
} from '@/test/meetingFixtures';
import { renderWithProviders } from '@/test/utils';
import { MeetingDetailPage } from './MeetingDetailPage';

const TEAM = {
  id: meeting().teamId,
  name: 'IntellMeet Demo Team',
  slug: 'intellmeet-demo',
  ownerId: HOST_ID,
  myRole: 'member',
  createdAt: '2026-09-01T10:00:00.000Z',
  members: [
    {
      userId: HOST_ID,
      name: 'Demo User',
      email: 'd@x',
      avatarUrl: null,
      role: 'admin',
      joinedAt: '',
    },
    {
      userId: GRACE_ID,
      name: 'Grace Hopper',
      email: 'g@x',
      avatarUrl: null,
      role: 'member',
      joinedAt: '',
    },
    {
      userId: SELF_ID,
      name: 'Ada Lovelace',
      email: 'a@x',
      avatarUrl: null,
      role: 'member',
      joinedAt: '',
    },
  ],
};

/**
 * The meeting page's fake API, plus the team (for the owner picker) and the
 * "create tasks" endpoint, which links each item it is sent to a new task.
 */
function serve() {
  const base = serveMeeting({ meeting: { isHost: false } });
  let current: MeetingIntelligence = intelligence();
  const requests: CreateTasksFromActionItemsInput[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith(`/teams/${TEAM.id}`)) return Response.json({ team: TEAM });
    if (url.endsWith(`/meetings/${MEETING_ID}/tasks`) && init?.method === 'POST') {
      const input = JSON.parse(String(init.body)) as CreateTasksFromActionItemsInput;
      requests.push(input);
      const tasks = input.items.map((item) =>
        boardTask({ title: item.actionItemId, assigneeId: item.assigneeId, dueDate: item.dueDate }),
      );
      const insight = current.insight;
      if (!insight) throw new Error('No insight');
      current = {
        ...current,
        insight: {
          ...insight,
          actionItems: insight.actionItems.map((actionItem) => {
            const index = input.items.findIndex((item) => item.actionItemId === actionItem.id);
            const made = tasks[index];
            return made
              ? {
                  ...actionItem,
                  taskId: made.id,
                  task: { id: made.id, boardId: BOARD_ID, columnTitle: 'To Do', isDone: false },
                }
              : actionItem;
          }),
        },
      };
      return Response.json({ tasks, skipped: [], intelligence: current }, { status: 201 });
    }
    if (url.endsWith('/intelligence')) return Response.json(current);
    return base(url, init);
  });

  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

async function openActionItems() {
  const view = renderWithProviders(<MeetingDetailPage />, {
    route: `/app/meetings/${MEETING_ID}?tab=actions`,
    path: '/app/meetings/:meetingId',
  });
  await screen.findByText('Fix the upload retry bug', {}, { timeout: 5_000 });
  return view;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('creating tasks from action items', () => {
  it('turns one item into a task, with the AI’s owner and date filled in', async () => {
    const requests = serve();
    const { user } = await openActionItems();

    // Any member can file tasks; this viewer is not the host.
    await user.click(
      screen.getByRole('button', { name: 'Create a task for “Fix the upload retry bug”' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Create a task' });

    const owner = within(dialog).getByRole('combobox', { name: /Assignee/ });
    await waitFor(() => expect(owner).toHaveValue(GRACE_ID));
    expect(within(dialog).getByLabelText(/Due date/)).toHaveValue('2026-09-18');

    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      items: [{ actionItemId: 'a1', assigneeId: GRACE_ID, dueDate: '2026-09-18' }],
    });

    // The item now says where its task is, and links to it.
    const link = await screen.findByRole('link', {
      name: 'Open the task for “Fix the upload retry bug”, in To Do',
    });
    expect(link.getAttribute('href')).toMatch(new RegExp(`^/app/tasks\\?board=${BOARD_ID}&task=`));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('turns several at once, letting some be left out', async () => {
    const requests = serve();
    const { user } = await openActionItems();

    await user.click(screen.getByRole('button', { name: 'Create tasks for all (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create tasks from action items' });

    // A name the AI heard that belongs to nobody is explained, not guessed at.
    expect(
      within(dialog).getByText('The AI heard “Sam”, who is not in the team.'),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('checkbox', { name: 'Fix the upload retry bug' }));
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Assignee for “Call the vendor”/ }),
      'Ada Lovelace',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Create 1 task' }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      items: [{ actionItemId: 'a2', assigneeId: SELF_ID, dueDate: null }],
    });
    expect(
      await screen.findByRole('link', { name: 'Open the task for “Call the vendor”, in To Do' }),
    ).toBeInTheDocument();
    // The other is still waiting for a task of its own.
    expect(
      screen.getByRole('button', { name: 'Create a task for “Fix the upload retry bug”' }),
    ).toBeInTheDocument();
  });
});
