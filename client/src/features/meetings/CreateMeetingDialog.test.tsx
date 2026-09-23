import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { CreateMeetingDialog } from './CreateMeetingDialog';

const teams = [
  {
    id: '507f1f77bcf86cd799439011',
    name: 'Platform',
    slug: 'platform',
    ownerId: '507f1f77bcf86cd799439099',
    members: [],
    myRole: 'admin' as const,
    createdAt: new Date().toISOString(),
  },
  {
    id: '507f1f77bcf86cd799439022',
    name: 'Design',
    slug: 'design',
    ownerId: '507f1f77bcf86cd799439099',
    members: [],
    myRole: 'member' as const,
    createdAt: new Date().toISOString(),
  },
];

function stubApi() {
  const bodies: Record<string, unknown>[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/teams') return Response.json({ teams });

      if (url === '/api/meetings') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);

        return Response.json({
          meeting: {
            id: '507f1f77bcf86cd799439033',
            teamId: body.teamId,
            title: body.title,
            description: null,
            hostId: '507f1f77bcf86cd799439099',
            hostName: 'Ada Lovelace',
            status: body.scheduledAt ? 'scheduled' : 'live',
            roomCode: 'T6G59G3',
            scheduledAt: body.scheduledAt ?? null,
            startedAt: body.scheduledAt ? null : new Date().toISOString(),
            endedAt: null,
            durationSec: null,
            participants: [],
            recording: null,
            aiStatus: 'none',
            isHost: true,
            createdAt: new Date().toISOString(),
          },
        });
      }

      return Response.json({});
    }),
  );

  return bodies;
}

function signedIn() {
  useAuthStore.setState({
    status: 'authenticated',
    user: {
      id: '507f1f77bcf86cd799439099',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarUrl: null,
      role: 'member',
      authProvider: 'local',
      createdAt: new Date().toISOString(),
    },
    accessToken: 'token',
  });
}

describe('<CreateMeetingDialog />', () => {
  it('lets the host pick which team the meeting belongs to', async () => {
    signedIn();
    stubApi();

    const { user } = renderWithProviders(<CreateMeetingDialog />);
    await user.click(screen.getByRole('button', { name: /new meeting/i }));

    const picker = await screen.findByLabelText('Team');
    // The regression this replaces: the dashboard used to start meetings in
    // whichever team happened to come back first.
    expect(within(picker).getAllByRole('option')).toHaveLength(2);
  });

  it('creates the meeting in the chosen team, not the first one', async () => {
    signedIn();
    const bodies = stubApi();

    const { user } = renderWithProviders(<CreateMeetingDialog />);
    await user.click(screen.getByRole('button', { name: /new meeting/i }));

    await user.selectOptions(await screen.findByLabelText('Team'), '507f1f77bcf86cd799439022');
    await user.type(screen.getByLabelText('Title'), 'Design review');
    await user.click(screen.getByRole('button', { name: /start now/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      teamId: '507f1f77bcf86cd799439022',
      title: 'Design review',
    });
    // No scheduledAt is what makes the server start it immediately.
    expect(bodies[0]).not.toHaveProperty('scheduledAt');
  });

  it('sends an ISO timestamp when the meeting is scheduled', async () => {
    signedIn();
    const bodies = stubApi();

    const { user } = renderWithProviders(<CreateMeetingDialog />);
    await user.click(screen.getByRole('button', { name: /new meeting/i }));

    await user.type(await screen.findByLabelText('Title'), 'Next week');
    await user.click(screen.getByLabelText(/schedule for later/i));
    await user.type(screen.getByLabelText('Date and time'), '2030-01-01T09:30');
    await user.click(screen.getByRole('button', { name: /schedule/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // The input produces a local datetime with no zone; the API contract is
    // ISO-8601 in UTC.
    expect(String(bodies[0]?.scheduledAt)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('refuses a title the server would reject anyway', async () => {
    signedIn();
    const bodies = stubApi();

    const { user } = renderWithProviders(<CreateMeetingDialog />);
    await user.click(screen.getByRole('button', { name: /new meeting/i }));

    await user.type(await screen.findByLabelText('Title'), 'x');
    await user.click(screen.getByRole('button', { name: /start now/i }));

    expect(await screen.findByText('Title must be at least 2 characters')).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });
});
