import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { PublicUser, TeamRole } from '@intellmeet/shared';
import { authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { TeamDetailPage } from './TeamDetailPage';

const TEAM_ID = '507f1f77bcf86cd799439012';

function openTeam(slug: string, name: string, myRole: TeamRole) {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as PublicUser,
    accessToken: 'access-token',
  });
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

  return renderWithProviders(<TeamDetailPage />, {
    route: `/app/teams/${TEAM_ID}`,
    path: '/app/teams/:teamId',
  });
}

describe('<TeamDetailPage /> for somebody who cannot invite', () => {
  it('tells a demo guest that people join with Try Live Demo instead', async () => {
    openTeam('intellmeet-demo', 'IntellMeet Demo Team', 'member');

    expect(await screen.findByText('How people join')).toBeInTheDocument();
    expect(screen.getByText(/Everyone who uses Try Live Demo is put in/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create invite link' })).not.toBeInTheDocument();
  });

  it('tells a member of any other team to ask an admin', async () => {
    openTeam('platform', 'Platform', 'member');

    expect(await screen.findByText(/Ask one of Platform's admins/)).toBeInTheDocument();
  });

  it('still gives an admin the invite panel itself', async () => {
    openTeam('platform', 'Platform', 'admin');

    expect(await screen.findByRole('button', { name: 'Create invite link' })).toBeInTheDocument();
    expect(screen.queryByText('How people join')).not.toBeInTheDocument();
  });
});
