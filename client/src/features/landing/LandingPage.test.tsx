import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { authPayload, renderWithProviders } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { LandingPage } from './LandingPage';

describe('<LandingPage />', () => {
  it('leads with one heading that says what the product does', () => {
    renderWithProviders(<LandingPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/IntellMeet/);
    // Exactly one h1 on the page: more than one is the most common reason a
    // Lighthouse accessibility audit drops points on a marketing page.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('explains how the product is used in four short steps', () => {
    renderWithProviders(<LandingPage />);

    const howItWorks = screen.getByRole('region', { name: 'How it works' });
    expect(within(howItWorks).getAllByRole('listitem')).toHaveLength(4);
    expect(within(howItWorks).getByText('Start a meeting')).toBeInTheDocument();
    expect(within(howItWorks).getByText('Get the write-up')).toBeInTheDocument();
  });

  it('offers the demo prominently, at the top and at the bottom', () => {
    renderWithProviders(<LandingPage />);

    expect(screen.getAllByRole('button', { name: /try live demo/i })).toHaveLength(2);
  });

  it('signs in as a new demo guest when the demo button is pressed', async () => {
    const guest = authPayload({
      user: { ...authPayload().user, name: 'Amber Otter', authProvider: 'guest' },
    });
    const fetchMock = vi.fn(async () => Response.json(guest, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const { user } = renderWithProviders(<LandingPage />);
    const [demoButton] = screen.getAllByRole('button', { name: /try live demo/i });
    if (!demoButton) throw new Error('The demo button is missing');

    await user.click(demoButton);

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().user?.name).toBe('Amber Otter');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/demo',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('tells reviewers that each demo sign-in is a different person', () => {
    renderWithProviders(<LandingPage />);

    // The promise the demo login now keeps: two windows are two people, so a
    // second reviewer is not the host of the first one's meeting.
    expect(screen.getByText(/your own guest name/i)).toBeInTheDocument();
    expect(screen.getByText(/every press of try live demo is a different guest/i)).toBeVisible();
  });

  it('gives a keyboard user a way past the header', () => {
    renderWithProviders(<LandingPage />);

    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
  });

  it('routes to sign-in and sign-up', () => {
    renderWithProviders(<LandingPage />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/register');
  });
});
