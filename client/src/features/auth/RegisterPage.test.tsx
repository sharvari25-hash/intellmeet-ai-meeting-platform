import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { RegisterPage } from './RegisterPage';

function stubFetch(handler: () => Response) {
  const mock = vi.fn(async () => handler());
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('<RegisterPage />', () => {
  it('renders the three fields and states the password rules up front', () => {
    stubFetch(() => Response.json(authPayload()));
    renderWithProviders(<RegisterPage />);

    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    // The rules are visible before the user fails them, not only afterwards.
    expect(screen.getByText(/at least 12 characters/i)).toBeInTheDocument();
  });

  it('enforces the shared password policy on the client', async () => {
    const fetchMock = stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a long password that has no digit', async () => {
    stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'NoDigitsHereAtAll');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must contain a number')).toBeInTheDocument();
  });

  it('creates the account and starts the session', async () => {
    const fetchMock = stubFetch(() => Response.json(authPayload()));
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('surfaces a duplicate email from the server', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify(apiErrorBody('CONFLICT', 'That email is already registered')), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    );

    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That email is already registered');
  });
});
