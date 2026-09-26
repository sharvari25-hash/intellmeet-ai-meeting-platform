import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes, useParams } from 'react-router-dom';
import type { PublicUser } from '@intellmeet/shared';
import { authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { DashboardPage } from './DashboardPage';

const team = {
  id: '507f1f77bcf86cd799439012',
  name: 'Platform',
  slug: 'platform',
  ownerId: '507f1f77bcf86cd799439011',
  members: [],
  myRole: 'member' as const,
  createdAt: new Date().toISOString(),
};

function RoomProbe() {
  return <h1>Room {useParams().roomCode}</h1>;
}

function InviteProbe() {
  return <h1>Invite {useParams().code}</h1>;
}

function renderDashboard() {
  useAuthStore.setState({
    status: 'authenticated',
    user: authPayload().user as PublicUser,
    accessToken: 'access-token',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/teams'
        ? Response.json({ teams: [team] })
        : Response.json({ meetings: [], total: 0, page: 1, limit: 5 }),
    ),
  );

  return renderWithProviders(
    <Routes>
      <Route path="/app" element={<DashboardPage />} />
      <Route path="/app/room/:roomCode" element={<RoomProbe />} />
      <Route path="/join/:code" element={<InviteProbe />} />
    </Routes>,
    { route: '/app' },
  );
}

describe('<DashboardPage /> Join with a code', () => {
  it('opens the room for a room code, however it was typed', async () => {
    const { user } = renderDashboard();

    await user.type(screen.getByLabelText('Room code'), 't6g 59g3');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('heading', { name: 'Room T6G59G3' })).toBeInTheDocument();
  });

  it('sends a team invite code to the join page, not to a room that cannot exist', async () => {
    const { user } = renderDashboard();

    await user.type(screen.getByLabelText('Room code'), 'ABCD2345');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('heading', { name: 'Invite ABCD2345' })).toBeInTheDocument();
  });

  it('opens the room from a whole pasted meeting link', async () => {
    const { user } = renderDashboard();

    // The link a chat app copies, which used to open "Page not found".
    await user.click(screen.getByLabelText('Room code'));
    await user.paste('https://intellmeet.example/app/room/T6G59G3');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('heading', { name: 'Room T6G59G3' })).toBeInTheDocument();
  });

  it('explains what a room code looks like instead of opening a dead page', async () => {
    const { user } = renderDashboard();

    const input = screen.getByLabelText('Room code');
    await user.type(input, 'hello');
    await user.click(screen.getByRole('button', { name: 'Join' }));

    expect(input).toHaveAccessibleDescription(/Room codes have 7 characters/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('heading', { name: /^Room / })).not.toBeInTheDocument();

    // Typing again clears the complaint.
    await user.type(input, 'x');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });
});
