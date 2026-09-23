import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import type { HealthResponse } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { fetchHealth } from '@/lib/health';

type State =
  { kind: 'loading' } | { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string };

/**
 * Phase 0 proof-of-wiring: the client fetches the server's health endpoint
 * through the same-origin /api path and renders the parsed result.
 * Replaced by the real dashboard in Phase 4; the data-fetching moves to
 * TanStack Query at the same time.
 */
export function HealthCard() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ok', data: await fetchHealth(signal) });
    } catch (error) {
      if (signal?.aborted) return;
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <section
      aria-labelledby="health-heading"
      className="w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
    >
      <header className="mb-4 flex items-center gap-2">
        <Activity aria-hidden="true" className="size-5 text-primary" />
        <h2 id="health-heading" className="text-base font-semibold">
          API connection
        </h2>
      </header>

      <div aria-live="polite" className="min-h-24">
        {state.kind === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Contacting the server…
          </p>
        )}

        {state.kind === 'error' && (
          <div className="space-y-1 text-sm">
            <p className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle aria-hidden="true" className="size-4" />
              Server unreachable
            </p>
            <p className="text-muted-foreground">{state.message}</p>
            <p className="text-muted-foreground">
              Is the API running on port 5000? Try <code>npm run dev</code>.
            </p>
          </div>
        )}

        {state.kind === 'ok' && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="flex items-center gap-1.5 font-medium text-[var(--success)]">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              {state.data.status}
            </dd>

            <dt className="text-muted-foreground">Service</dt>
            <dd className="font-medium">{state.data.service}</dd>

            <dt className="text-muted-foreground">Version</dt>
            <dd className="font-medium">{state.data.version}</dd>

            <dt className="text-muted-foreground">Environment</dt>
            <dd className="font-medium">{state.data.environment}</dd>

            <dt className="text-muted-foreground">Uptime</dt>
            <dd className="font-medium">{state.data.uptimeSec}s</dd>
          </dl>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        onClick={() => void load()}
        disabled={state.kind === 'loading'}
      >
        <RefreshCw aria-hidden="true" className={state.kind === 'loading' ? 'animate-spin' : ''} />
        Re-check
      </Button>
    </section>
  );
}
