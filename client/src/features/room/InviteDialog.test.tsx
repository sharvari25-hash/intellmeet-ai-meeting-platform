import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Meeting, TeamRole } from '@intellmeet/shared';
import { renderWithProviders } from '@/test/utils';
import { InviteDialog } from './InviteDialog';

const TEAM_ID = '507f1f77bcf86cd799439012';

const meeting = {
  id: '507f1f77bcf86cd799439033',
  teamId: TEAM_ID,
  title: 'Release sync',
  description: null,
  hostId: '507f1f77bcf86cd799439099',
  hostName: 'Amber Otter',
  status: 'live',
  roomCode: 'T6G59G3',
  scheduledAt: null,
  startedAt: new Date().toISOString(),
  endedAt: null,
  durationSec: null,
  participants: [],
  recording: null,
  aiStatus: 'none',
  isHost: true,
  createdAt: new Date().toISOString(),
} satisfies Meeting;

function serveTeam(slug: string, name: string, myRole: TeamRole) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        team: {
          id: TEAM_ID,
          name,
          slug,
          ownerId: '507f1f77bcf86cd799439011',
          members: [],
          myRole,
          createdAt: new Date().toISOString(),
        },
      }),
    ),
  );
}

async function open() {
  const rendered = renderWithProviders(<InviteDialog meeting={meeting} />);
  await rendered.user.click(screen.getByRole('button', { name: 'Invite' }));
  return rendered;
}

describe('<InviteDialog />', () => {
  it('tells a demo host that people join with Try Live Demo', async () => {
    serveTeam('intellmeet-demo', 'IntellMeet Demo Team', 'member');
    await open();

    const dialog = await screen.findByRole('dialog', { name: 'Invite people' });
    expect(await screen.findByText(/everyone who uses Try Live Demo is one/)).toBeInTheDocument();
    // The people this used to strand: they had signed up instead.
    expect(dialog).toHaveTextContent(/signed in with their own account is not in this team/);
  });

  it('tells a team admin to invite people to the team first, and links there', async () => {
    serveTeam('platform', 'Platform', 'admin');
    await open();

    expect(await screen.findByText(/needs a team invite link from you first/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a team invite link' })).toHaveAttribute(
      'href',
      `/app/teams/${TEAM_ID}`,
    );
  });

  it('tells a member that only an admin can invite people', async () => {
    serveTeam('platform', 'Platform', 'member');
    await open();

    expect(await screen.findByText(/from one of its admins first/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Create a team invite link' }),
    ).not.toBeInTheDocument();
  });

  it('shows the link and the room code, and copies the link', async () => {
    serveTeam('platform', 'Platform', 'member');
    const { user } = await open();

    const link = `${window.location.origin}/app/room/T6G59G3`;
    expect(screen.getByLabelText('Meeting link')).toHaveValue(link);
    expect(screen.getByText('T6G59G3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await navigator.clipboard.readText()).toBe(link);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
