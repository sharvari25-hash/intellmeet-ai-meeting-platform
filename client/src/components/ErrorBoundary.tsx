import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so one broken component does not blank the app.
 *
 * Still a class component in React 19: `componentDidCatch` has no hook
 * equivalent, and the official guidance is unchanged. React Query handles
 * *async* failures, which never reach here - this is for the exceptions thrown
 * while rendering.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Phase 13 forwards this to Sentry; until then the console is the record.
    console.error('[ui] render failed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-card-foreground">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle aria-hidden="true" className="size-5 text-destructive" />
            Something broke
          </h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected error. Reloading usually clears it.
          </p>
          <p className="break-words rounded-md bg-muted p-3 font-mono text-xs">{error.message}</p>
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
        </div>
      </div>
    );
  }
}
