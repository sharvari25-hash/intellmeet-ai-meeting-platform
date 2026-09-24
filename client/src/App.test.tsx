import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { authPayload, apiErrorBody, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import App from './App';

// The socket is exercised by the server's own integration suite over a real
// WebSocket. In jsdom it would only attempt a doomed connection to the test
// origin and log the failure, so it is stubbed out here.
vi.mock('@/lib/socket', () => ({ connectSocket: vi.fn() }));

/**
 * Every render of <App /> runs the session bootstrap, which POSTs to
 * /api/auth/refresh. A stub that refuses is the signed-out case; one that
 * returns a payload is the "reload while signed in" case.
 */
function stubRefresh(result: 'anonymous' | 'authenticated') {
  const mock = vi.fn(async (url: string) => {
    if (url === '/api/auth/refresh') {
      return result === 'authenticated'
        ? Response.json(authPayload())
        : new Response(JSON.stringify(apiErrorBody('UNAUTHORIZED', 'No active session')), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          });
    }
    // Anything the dashboard asks for afterwards.
    return Response.json({ teams: [], meetings: [], total: 0, page: 1, limit: 20 });
  });

  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('routing', () => {
  it('shows the landing page at the root', async () => {
    stubRefresh('anonymous');
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/IntellMeet/);
    expect(screen.getAllByRole('button', { name: /try live demo/i }).length).toBeGreaterThan(0);
  });

  it('sends an anonymous visitor from a protected route to sign in', async () => {
    stubRefresh('anonymous');
    renderWithProviders(<App />, { route: '/app' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Welcome back' }),
    ).toBeInTheDocument();
  });

  it('restores the session on a reload and keeps the user on their page', async () => {
    stubRefresh('authenticated');
    renderWithProviders(<App />, { route: '/app/settings' });

    // Proves the whole chain: refresh cookie -> access token in memory ->
    // guard lets the route through -> the page renders.
    //
    // Two lazy chunks (the shell, then the page) load behind the refresh, and
    // under a full parallel run that alone can pass the default 1s wait.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Settings' }, { timeout: 5_000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
  });

  it('renders a 404 page for an unknown path', async () => {
    stubRefresh('anonymous');
    renderWithProviders(<App />, { route: '/does-not-exist' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
  });

  it('shows the invite screen for a join link without an account', async () => {
    stubRefresh('anonymous');
    renderWithProviders(<App />, { route: '/join/ABC234' });

    expect(
      await screen.findByRole('heading', { level: 1, name: /invited to a team/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
