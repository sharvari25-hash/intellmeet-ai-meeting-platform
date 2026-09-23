import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Renders a component inside the providers it expects.
 *
 * Every page in this app reads from React Query and the router, so rendering
 * one bare throws before the first assertion. Retries are off: a test that
 * asserts on an error path should not wait for two silent retries first.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string; path?: string } = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const { route = '/', path } = options;

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          {/* A `path` lets a test exercise a component that reads route
              params, without standing up the whole route tree. */}
          {path ? (
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

/** A successful auth payload, shaped exactly like `authResponseSchema`. */
export function authPayload(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: '507f1f77bcf86cd799439011',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      avatarUrl: null,
      role: 'member',
      authProvider: 'local',
      createdAt: new Date().toISOString(),
    },
    accessToken: 'access-token',
    expiresInSec: 900,
    ...overrides,
  };
}

/** An error body in the shape every non-2xx API response uses. */
export function apiErrorBody(code: string, message: string) {
  return { error: { code, message, requestId: 'test-request' } };
}
