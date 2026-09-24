import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { UserMenu } from './UserMenu';

function signInAs(overrides: Record<string, unknown>) {
  useAuthStore.setState({
    status: 'authenticated',
    user: { ...authPayload().user, ...overrides } as never,
    accessToken: 'access-token',
  });
}

function renderMenu() {
  return renderWithProviders(
    <Routes>
      <Route path="/app" element={<UserMenu />} />
      <Route path="/" element={<h1>Landing page</h1>} />
    </Routes>,
    { route: '/app' },
  );
}

describe('<UserMenu />', () => {
  it('lets a demo guest end the session, deleting the guest after confirming', async () => {
    signInAs({ name: 'Amber Otter', authProvider: 'guest', email: 'x@guest.intellmeet.invalid' });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const { user } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Account menu for Amber Otter' }));

    // The synthetic address means nothing to a guest, so it is not shown.
    const hint = screen.getByText('Demo guest - rename yourself in Settings');
    expect(screen.queryByText('x@guest.intellmeet.invalid')).not.toBeInTheDocument();
    // It wraps inside the 15rem menu rather than being cut off mid-sentence.
    expect(hint).not.toHaveClass('truncate');

    await user.click(screen.getByRole('menuitem', { name: 'End demo session' }));

    // Nothing is deleted until the dialog is confirmed.
    const dialog = await screen.findByRole('dialog', { name: 'End the demo session?' });
    expect(dialog).toHaveTextContent('Amber Otter');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'End session' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/demo',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(await screen.findByRole('heading', { name: 'Landing page' })).toBeInTheDocument();
  });

  it('keeps the guest signed in and says why when the delete fails', async () => {
    signInAs({ name: 'Amber Otter', authProvider: 'guest' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(apiErrorBody('INTERNAL_ERROR', 'Database unavailable'), { status: 500 }),
      ),
    );

    const { user } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Account menu for Amber Otter' }));
    await user.click(screen.getByRole('menuitem', { name: 'End demo session' }));
    await user.click(await screen.findByRole('button', { name: 'End session' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Database unavailable');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('does not offer to delete a real account', async () => {
    signInAs({ name: 'Ada Lovelace', authProvider: 'local' });

    const { user } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Account menu for Ada Lovelace' }));

    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'End demo session' })).not.toBeInTheDocument();
  });
});
