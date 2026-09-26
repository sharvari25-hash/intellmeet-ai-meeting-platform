import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetRefreshState } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';

// How long findBy*/waitFor wait for the UI before failing (default 1 s).
// Coverage instrumentation makes rendering two to three times slower, and a
// 2-vCPU CI runner slower again: at 1 s the analytics, history and editing
// tests timed out under `test:coverage` although nothing was wrong. A waiting
// query returns as soon as its element appears, so a higher ceiling costs a
// passing test nothing; it only decides how long a real failure takes.
configure({ asyncUtilTimeout: 5_000 });

// jsdom has no matchMedia, and the theme store calls it on import. Returning a
// "light, never changes" implementation is enough for every test here.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom has no ResizeObserver either; charts (Recharts) measure with it.
// Nothing in the suite depends on a real size change.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => {
  // The auth store and the refresh queue are module-level singletons, so a
  // session left behind by one test would silently change the next one's
  // starting conditions. 'bootstrapping' is the real initial state - resetting
  // to 'anonymous' would let a route guard redirect before the session had a
  // chance to be restored, which is not how the app behaves.
  useAuthStore.setState({
    status: 'bootstrapping',
    user: null,
    accessToken: null,
    signedOut: false,
  });
  resetRefreshState();

  // A parked invite code outlives a test otherwise, and would redirect the
  // next one somewhere it never asked to go.
  sessionStorage.clear();
});

// React Testing Library does not auto-clean when `globals: true` is combined
// with a custom setup file, so unmount between tests to keep them isolated.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
