import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import App from '@/App';
import { peekReturnPath } from '@/features/auth/returnPath';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';

vi.mock('@/lib/socket', () => ({ connectSocket: vi.fn() }));

// These tests are about where a visitor lands, not the room itself, whose
// chunk carries the whole WebRTC stack and is slow to load cold in jsdom.
vi.mock('@/features/room/RoomPage', async () => {
  const { useParams } = await import('react-router-dom');
  return { RoomPage: () => <h1>Room {useParams().roomCode}</h1> };
});

const ROOM = '/app/room/T6G59G3';

/** The first navigation into the app loads the shell's chunk cold. */
const ARRIVAL = { timeout: 15_000 };

const guest = authPayload({
  user: { ...authPayload().user, name: 'Jade Falcon', authProvider: 'guest' },
});

/** Records every URL the app fetches; signed in or out to begin with. */
function stubApi({ signedIn }: { signedIn: boolean }): string[] {
  const calls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);

      if (url === '/api/auth/refresh') {
        if (signedIn) return Response.json(authPayload());
        return new Response(JSON.stringify(apiErrorBody('UNAUTHORIZED', 'No active session')), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/auth/demo') return Response.json(guest, { status: 201 });
      if (url === '/api/auth/logout') return new Response(null, { status: 204 });

      return Response.json({ teams: [], notifications: [], unreadCount: 0 });
    }),
  );

  return calls;
}

describe('a room link opened while signed out', () => {
  it('reaches the room after Try Live Demo on the landing page', async () => {
    stubApi({ signedIn: false });
    const { user } = renderWithProviders(<App />, { route: ROOM });

    // Sent to sign in. Without an account, the obvious move from there is the
    // landing page's Try Live Demo - whose sign-in has no router state to
    // read, so it used to drop the visitor on the dashboard, room forgotten.
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.click(screen.getByRole('link', { name: 'IntellMeet' }));
    const [demo] = await screen.findAllByRole('button', { name: /try live demo/i });
    if (!demo) throw new Error('The demo button is missing');
    await user.click(demo);

    expect(await screen.findByRole('heading', { name: 'Room T6G59G3' }, ARRIVAL)).toBeVisible();
    // Its job done, the parked page does not steer any later sign-in.
    await waitFor(() => expect(peekReturnPath()).toBeNull());
  });

  it("reaches the room after the sign-in page's own demo button", async () => {
    stubApi({ signedIn: false });
    const { user } = renderWithProviders(<App />, { route: ROOM });

    await user.click(await screen.findByRole('button', { name: /try the live demo/i }));

    expect(await screen.findByRole('heading', { name: 'Room T6G59G3' }, ARRIVAL)).toBeVisible();
  });
});

describe('signing out', () => {
  it('does not send the next sign-in back to the page somebody signed out of', async () => {
    stubApi({ signedIn: true });
    const { user } = renderWithProviders(<App />, { route: '/app/settings' });

    const [menu] = await screen.findAllByRole('button', { name: /account menu for/i }, ARRIVAL);
    if (!menu) throw new Error('The account menu is missing');
    await user.click(menu);
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    // Home, as the sign-out handler intends - it used to land on /login,
    // remembering /app/settings for whoever signed in next on this tab.
    await screen.findAllByRole('button', { name: /try live demo/i });
    expect(peekReturnPath()).toBeNull();
  });
});
