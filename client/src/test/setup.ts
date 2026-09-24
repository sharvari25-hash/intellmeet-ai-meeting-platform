import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetRefreshState } from '@/lib/apiClient';
import { useAuthStore } from '@/stores/authStore';

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
  useAuthStore.setState({ status: 'bootstrapping', user: null, accessToken: null });
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
