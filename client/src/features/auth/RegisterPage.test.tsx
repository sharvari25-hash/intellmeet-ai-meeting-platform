import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { RegisterPage } from './RegisterPage';

const SENT = { expiresInSec: 600, resendAfterSec: 60 };

type Handler = (init?: RequestInit) => Response;

/** Answers each API path with its handler, and records every call. */
function stubApi(routes: Record<string, Handler>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const handler = routes[url];
    return handler ? handler(init) : new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const accepted = () => Response.json(SENT, { status: 202 });

const failure = (status: number, code: string, message: string) =>
  new Response(JSON.stringify(apiErrorBody(code, message)), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** The JSON body of the n-th call to the API. */
function bodyOf(mock: ReturnType<typeof stubApi>, call: number): unknown {
  const init = mock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(init?.body as string);
}

describe('<RegisterPage />', () => {
  it('asks for a name and an email, and no password', () => {
    stubApi({});
    renderWithProviders(<RegisterPage />);

    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByText(/6-digit code\. No password needed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBeInTheDocument();
  });

  it('checks the name and the email before calling the API', async () => {
    const fetchMock = stubApi({});
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'A');
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(await screen.findByText('Name must be at least 2 characters')).toBeInTheDocument();
    expect(screen.getByText('Must be a valid email address')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emails a code, then asks for it, naming the address', async () => {
    const fetchMock = stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(await screen.findByLabelText('6-digit code')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText(/works for 10 minutes/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/code',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(bodyOf(fetchMock, 0)).toEqual({
      purpose: 'register',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });
    // Nobody is signed in by asking for a code.
    expect(useAuthStore.getState().status).not.toBe('authenticated');
  });

  it('puts the cursor in the code field, where the next thing they do is type', async () => {
    stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    await waitFor(() => expect(screen.getByLabelText('6-digit code')).toHaveFocus());
  });

  it('creates the account and starts the session when the code is entered', async () => {
    const fetchMock = stubApi({
      '/api/auth/code': accepted,
      '/api/auth/code/verify': () => Response.json(authPayload()),
    });
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '042917');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().accessToken).toBe('access-token');
    expect(bodyOf(fetchMock, 1)).toEqual({ email: 'ada@example.com', code: '042917' });
  });

  it('shows the server message for a code that is wrong, and signs nobody in', async () => {
    stubApi({
      '/api/auth/code': accepted,
      '/api/auth/code/verify': () =>
        failure(401, 'UNAUTHORIZED', 'That code is incorrect or has expired. Request a new one.'),
    });
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is incorrect or has expired',
    );
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('shows why the email could not be sent, and stays on the first step', async () => {
    stubApi({
      '/api/auth/code': () =>
        failure(503, 'SERVICE_UNAVAILABLE', "We couldn't send the email. Please try again."),
    });
    const { user } = renderWithProviders(<RegisterPage />);

    await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't send the email");
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
  });
});
