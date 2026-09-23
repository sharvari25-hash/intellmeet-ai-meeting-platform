import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { LoginPage } from './LoginPage';

/** Stubs fetch and hands back the mock so a test can assert on the calls. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('<LoginPage />', () => {
  it('renders the sign-in form and the demo shortcut', () => {
    stubFetch(() => Response.json(authPayload()));
    renderWithProviders(<LoginPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try the live demo/i })).toBeInTheDocument();
  });

  it('validates against the shared schema before calling the API', async () => {
    const fetchMock = stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Must be a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    // The important half of the assertion: an invalid form never reaches the
    // network, so the server is not doing validation the client could do.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the invalid field for assistive technology, not just visually', async () => {
    stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const email = await screen.findByLabelText('Email');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(email).toHaveAccessibleDescription('Must be a valid email address');
  });

  it('signs in and stores the session in memory', async () => {
    const fetchMock = stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().accessToken).toBe('access-token');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows the server message when the credentials are rejected', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(apiErrorBody('UNAUTHORIZED', 'Invalid email or password')), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Wrong-password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password');
    // A rejected sign-in must not leave a half-built session behind.
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('rewords a rate limit so it does not read as a wrong password', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(apiErrorBody('RATE_LIMITED', 'Too many requests')), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { user } = renderWithProviders(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('opens the demo account without any credentials', async () => {
    const fetchMock = stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<LoginPage />);

    await user.click(screen.getByRole('button', { name: /try the live demo/i }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/demo',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
