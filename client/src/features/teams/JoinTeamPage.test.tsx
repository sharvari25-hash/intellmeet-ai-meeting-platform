import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { peekPendingInvite, rememberInvite } from './pendingInvite';

vi.mock('@/lib/socket', () => ({ connectSocket: vi.fn() }));

const team = {
  id: '507f1f77bcf86cd799439099',
  name: 'Platform',
  slug: 'platform',
  ownerId: '507f1f77bcf86cd799439011',
  members: [],
  myRole: 'member' as const,
  createdAt: new Date().toISOString(),
};

/** Signed out to begin with; every auth call succeeds; records the URLs hit. */
function stubApi(): string[] {
  const calls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);

      if (url === '/api/auth/refresh') {
        return new Response(JSON.stringify(apiErrorBody('UNAUTHORIZED', 'No active session')), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/auth/login' || url === '/api/auth/register') {
        return Response.json(authPayload());
      }
      if (url === '/api/teams/join') return Response.json({ team });

      return Response.json({ teams: [], notifications: [], unreadCount: 0 });
    }),
  );

  return calls;
}

describe('invite links', () => {
  it('redeems the code immediately when the visitor is already signed in', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === '/api/auth/refresh') return Response.json(authPayload());
        if (url === '/api/teams/join') return Response.json({ team });
        return Response.json({ teams: [], notifications: [], unreadCount: 0 });
      }),
    );

    renderWithProviders(<App />, { route: '/join/ABC234' });

    await waitFor(() => expect(calls).toContain('/api/teams/join'));
  });

  it('completes the join after signing in from the invite screen', async () => {
    const calls = stubApi();
    const { user } = renderWithProviders(<App />, { route: '/join/ABC234' });

    await user.click(await screen.findByRole('link', { name: 'Sign in' }));

    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    // The regression this covers: the guard on /login used to redirect to
    // /app in the same commit, overwriting the trip back to the invite.
    await waitFor(() => expect(calls).toContain('/api/teams/join'));
  });

  it('completes the join after creating an account from the invite screen', async () => {
    const calls = stubApi();
    const { user } = renderWithProviders(<App />, { route: '/join/ABC234' });

    await user.click(await screen.findByRole('link', { name: 'Create an account' }));

    await user.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(calls).toContain('/api/teams/join'));
  });

  it('remembers the code so it survives a sign-in reached any other way', async () => {
    const calls = stubApi();

    // Seeing the invite screen parks the code...
    const first = renderWithProviders(<App />, { route: '/join/ABC234' });
    await screen.findByRole('heading', { name: /invited to a team/i });
    expect(peekPendingInvite()).toBe('ABC234');

    // ...so a visitor who then opens /register directly - a second tab, an
    // email link, a password manager - is still taken back to the invite.
    first.unmount();

    const { user } = renderWithProviders(<App />, { route: '/register' });
    await user.type(await screen.findByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(calls).toContain('/api/teams/join'));
  });

  it('drops a code that could not be redeemed instead of retrying it forever', async () => {
    rememberInvite('DEADCODE');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/refresh') return Response.json(authPayload());
        if (url === '/api/teams/join') {
          return new Response(JSON.stringify(apiErrorBody('NOT_FOUND', 'Invite code not found')), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        return Response.json({ teams: [], notifications: [], unreadCount: 0 });
      }),
    );

    renderWithProviders(<App />, { route: '/join/DEADCODE' });

    expect(await screen.findByRole('heading', { name: /did not work/i })).toBeInTheDocument();
    // Otherwise a dead code would hijack every later sign-in on this tab.
    expect(peekPendingInvite()).toBeNull();
  });
});
