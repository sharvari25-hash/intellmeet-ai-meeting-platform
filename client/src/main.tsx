import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { createQueryClient } from '@/lib/queryClient';
import { applyTheme, useThemeStore } from '@/stores/themeStore';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

// The inline script in index.html has already applied the stored preference to
// avoid a flash of the wrong theme; this re-applies it from the same source so
// the store and the DOM cannot start out disagreeing.
applyTheme(useThemeStore.getState().theme);

// Follow the OS when - and only when - the user chose "system".
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useThemeStore.getState().theme === 'system') applyTheme('system');
});

const queryClient = createQueryClient();

createRoot(rootElement).render(
  <StrictMode>
    {/*
      Order matters. The error boundary is outermost so a crash inside any
      provider still renders the fallback rather than a blank page. The router
      sits inside the query client because hooks in the route tree use both.
    */}
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
