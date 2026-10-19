import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { apiErrorBody, authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { EmailCodeForm } from './EmailCodeForm';

const SENT = { expiresInSec: 600, resendAfterSec: 60 };

function stubApi(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (url: string, _init?: RequestInit) => {
    const handler = routes[url];
    return handler ? handler() : new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const accepted = () => Response.json(SENT, { status: 202 });

function bodyOf(mock: ReturnType<typeof stubApi>, call: number): unknown {
  const init = mock.mock.calls[call]?.[1];
  return JSON.parse(init?.body as string);
}

/** Types an address on the sign-in form and gets to the code step. */
async function askForCode(user: ReturnType<typeof renderWithProviders>['user']) {
  await user.type(screen.getByLabelText('Email'), 'ada@example.com');
  await user.click(screen.getByRole('button', { name: 'Email me a code' }));
  return screen.findByLabelText('6-digit code');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('<EmailCodeForm purpose="login" />', () => {
  it('asks only for an address to sign in, and says what will happen', () => {
    stubApi({});
    renderWithProviders(<EmailCodeForm purpose="login" />);

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    expect(screen.getByText(/we.ll email you a 6-digit code/i)).toBeInTheDocument();
  });

  it('requests a sign-in code, not a sign-up one', async () => {
    const fetchMock = stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

    await askForCode(user);

    expect(bodyOf(fetchMock, 0)).toEqual({ purpose: 'login', email: 'ada@example.com' });
  });

  it('signs in with the code', async () => {
    const fetchMock = stubApi({
      '/api/auth/code': accepted,
      '/api/auth/code/verify': () => Response.json(authPayload()),
    });
    const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

    await user.type(await askForCode(user), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(bodyOf(fetchMock, 1)).toEqual({ email: 'ada@example.com', code: '123456' });
  });

  it('accepts the code as it was typed from the email, spaces and all', async () => {
    const fetchMock = stubApi({
      '/api/auth/code': accepted,
      '/api/auth/code/verify': () => Response.json(authPayload()),
    });
    const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

    await user.type(await askForCode(user), ' 123 456 ');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock, 1)).toEqual({ email: 'ada@example.com', code: '123456' });
  });

  it('does not send a code that cannot be right', async () => {
    const fetchMock = stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

    await user.type(await askForCode(user), '12345');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    const field = screen.getByLabelText('6-digit code');
    expect(await screen.findByText('Enter the 6-digit code')).toBeInTheDocument();
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAccessibleDescription('Enter the 6-digit code');
    // Only the request for the code went out.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rewords a rate limit so it does not read as a wrong code', async () => {
    stubApi({
      '/api/auth/code': accepted,
      '/api/auth/code/verify': () =>
        new Response(JSON.stringify(apiErrorBody('RATE_LIMITED', 'Too many incorrect codes.')), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

    await user.type(await askForCode(user), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('goes back to the address with what was typed still there', async () => {
    stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

    await askForCode(user);
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));

    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument();
  });

  describe('asking for another code', () => {
    /**
     * Fakes the clock and the interval that counts down, and leaves
     * `setTimeout` alone: user-event and the waiting queries run on it.
     */
    function useClock() {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    }

    const wait = (seconds: number) => act(() => vi.advanceTimersByTime(seconds * 1000));

    it('holds the button for the server cooldown, counting down', async () => {
      useClock();
      stubApi({ '/api/auth/code': accepted });
      const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

      await askForCode(user);
      const button = screen.getByRole('button', { name: /resend code/i });

      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Resend code in 60s');

      await wait(25);
      expect(button).toHaveTextContent('Resend code in 35s');
      expect(button).toBeDisabled();

      await wait(35);
      expect(button).toHaveTextContent('Resend code');
      expect(button).toBeEnabled();
    });

    it('sends the same request again, says so, and starts the wait over', async () => {
      useClock();
      const fetchMock = stubApi({ '/api/auth/code': accepted });
      const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

      await user.type(await askForCode(user), '999');
      await wait(60);
      await user.click(screen.getByRole('button', { name: 'Resend code' }));

      expect(await screen.findByText('A new code is on its way.')).toBeInTheDocument();
      expect(bodyOf(fetchMock, 1)).toEqual(bodyOf(fetchMock, 0));
      expect(screen.getByRole('button', { name: /resend code/i })).toBeDisabled();
      // The old code is gone, so what was half-typed for it is too.
      expect(screen.getByLabelText('6-digit code')).toHaveValue('');
    });

    it('shows why a new code was refused, and lets them try again', async () => {
      useClock();
      let calls = 0;
      stubApi({
        '/api/auth/code': () =>
          ++calls === 1
            ? accepted()
            : new Response(
                JSON.stringify(
                  apiErrorBody('SERVICE_UNAVAILABLE', "We couldn't send the email. Try again."),
                ),
                { status: 503, headers: { 'content-type': 'application/json' } },
              ),
      });
      const { user } = renderWithProviders(<EmailCodeForm purpose="login" />);

      await askForCode(user);
      await wait(60);
      await user.click(screen.getByRole('button', { name: 'Resend code' }));

      expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't send the email");
      expect(screen.getByRole('button', { name: 'Resend code' })).toBeEnabled();
    });
  });
});

describe('<EmailCodeForm purpose="register" />', () => {
  it('asks for a name as well, and sends it with the request', async () => {
    const fetchMock = stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<EmailCodeForm purpose="register" />);

    await user.type(screen.getByLabelText('Full name'), 'Grace Hopper');
    await user.type(await screen.findByLabelText('Email'), 'grace@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('6-digit code');

    expect(bodyOf(fetchMock, 0)).toEqual({
      purpose: 'register',
      email: 'grace@example.com',
      name: 'Grace Hopper',
    });
  });

  it('keeps the name and address when they go back to fix a typo', async () => {
    stubApi({ '/api/auth/code': accepted });
    const { user } = renderWithProviders(<EmailCodeForm purpose="register" />);

    await user.type(screen.getByLabelText('Full name'), 'Grace Hopper');
    await user.type(screen.getByLabelText('Email'), 'grace@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await screen.findByLabelText('6-digit code');
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));

    expect(screen.getByLabelText('Full name')).toHaveValue('Grace Hopper');
    expect(screen.getByLabelText('Email')).toHaveValue('grace@example.com');
  });
});
