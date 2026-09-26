import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { PublicUser } from '@intellmeet/shared';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { RoomPage } from './RoomPage';

function signIn(authProvider: 'local' | 'guest') {
  useAuthStore.setState({
    status: 'authenticated',
    user: { ...authPayload().user, authProvider } as PublicUser,
    accessToken: 'access-token',
  });
}

/** The room-code lookup fails the way the server says it does. */
function lookupFails(status: number, code: string, message: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      status === 0
        ? Promise.reject(new TypeError('Failed to fetch'))
        : new Response(JSON.stringify(apiErrorBody(code, message)), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
    ),
  );
}

function openRoom(roomCode = 'T6G59G3') {
  return renderWithProviders(<RoomPage />, {
    route: `/app/room/${roomCode}`,
    path: '/app/room/:roomCode',
  });
}

const NOT_IN_TEAM =
  "This meeting belongs to a team you're not in. Ask the host for a team invite link.";

// Every one of these used to be headed "That meeting is not available", so a
// working link sent to somebody outside the team read exactly like a typo.
describe('<RoomPage /> when the code does not open a room', () => {
  it('tells somebody outside the team that is the problem, and how to get in', async () => {
    signIn('local');
    lookupFails(403, 'FORBIDDEN', NOT_IN_TEAM);
    openRoom();

    expect(
      await screen.findByRole('heading', { name: "You're not in this meeting's team" }),
    ).toBeInTheDocument();
    expect(screen.getByText(NOT_IN_TEAM)).toBeInTheDocument();
    // Somebody who signed up can still join a demo meeting the host's way.
    expect(screen.getByText(/choose Try Live Demo/)).toBeInTheDocument();
    expect(screen.queryByText(/not available/)).not.toBeInTheDocument();
  });

  it('does not tell a demo guest to become a demo guest', async () => {
    signIn('guest');
    lookupFails(403, 'FORBIDDEN', NOT_IN_TEAM);
    openRoom();

    await screen.findByRole('heading', { name: "You're not in this meeting's team" });
    expect(screen.queryByText(/choose Try Live Demo/)).not.toBeInTheDocument();
  });

  it('says a wrong code is a wrong code', async () => {
    signIn('guest');
    lookupFails(404, 'NOT_FOUND', 'No meeting found for that code');
    openRoom('ZZZZZZZ');

    expect(await screen.findByRole('heading', { name: 'No meeting has that code' })).toBeVisible();
    expect(screen.getByText(/Room codes have 7 characters/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /team invite/ })).not.toBeInTheDocument();
  });

  it('offers to use an 8-character code as the team invite it probably is', async () => {
    signIn('guest');
    lookupFails(404, 'NOT_FOUND', 'No meeting found for that code');
    openRoom('ABCD2345');

    await screen.findByRole('heading', { name: 'No meeting has that code' });
    expect(screen.getByRole('link', { name: 'Use it as a team invite' })).toHaveAttribute(
      'href',
      '/join/ABCD2345',
    );
  });

  it('says an ended meeting has ended, and where its summary is', async () => {
    signIn('guest');
    lookupFails(409, 'CONFLICT', 'That meeting has already ended');
    openRoom();

    expect(await screen.findByRole('heading', { name: 'This meeting has ended' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Meeting history' })).toHaveAttribute(
      'href',
      '/app/meetings',
    );
  });

  it('offers a retry when the request itself failed', async () => {
    signIn('guest');
    lookupFails(0, '', '');
    openRoom();

    expect(
      await screen.findByRole('heading', { name: 'Could not open the meeting' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
