import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'intellmeet-theme';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Safari in private mode throws on localStorage access rather than
    // returning null, so a theme preference must never be load-bearing.
  }
  return 'system';
}

/** Adds or removes the single `dark` class the Tailwind v4 variant keys off. */
export function applyTheme(theme: Theme): void {
  const prefersDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  document.documentElement.classList.toggle('dark', prefersDark);
  document.documentElement.style.colorScheme = prefersDark ? 'dark' : 'light';
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

/**
 * Theme as a store rather than a React context.
 *
 * A context would need a provider component plus a hook exported from the same
 * module, which is exactly the pattern Fast Refresh cannot handle. A store has
 * neither, and the non-React `applyTheme` above can be called from the
 * blocking script in index.html that prevents a flash of the wrong theme.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference simply does not persist; the current tab still switches.
    }
    applyTheme(theme);
    set({ theme });
  },
}));
