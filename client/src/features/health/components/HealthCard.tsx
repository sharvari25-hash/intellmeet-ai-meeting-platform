import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import type { DependencyHealth, HealthResponse } from '@intellmeet/shared';
import { Button } from '@/components/ui/button';
import { fetchHealth } from '@/lib/health';

type State =
  { kind: 'loading' } | { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string };

/** One dependency row: MongoDB or Redis, with its probe latency or failure reason. */
function DependencyRow({ name, health }: { name: string; health: DependencyHealth }) {
  const isUp = health.status === 'up';

  return (
    <div className="flex items-start justify-between gap-4 border-t py-2 first:border-t-0">
      <span className="text-muted-foreground">{name}</span>
      <span className="flex items-center gap-1.5 text-right font-medium">
        {isUp ? (
          <CheckCircle2 aria-hidden="true" className="size-4 text-[var(--success)]" />
        ) : (
          <XCircle aria-hidden="true" className="size-4 text-destructive" />
        )}
        <span className={isUp ? 'text-[var(--success)]' : 'text-destructive'}>{health.status}</span>
        {health.latencyMs !== undefined && (
          <span className="text-xs text-muted-foreground">({health.latencyMs}ms)</span>
        )}
      </span>
    </div>
  );
}

/**
 * Live status of the API and its dependencies.
 *
 * Built in Phase 1 to prove the client/server wiring; it now lives on the
 * settings page, where "is the backend up?" is a genuinely useful thing for
 * an operator - or a reviewer running this locally - to be able to check
 * without opening a terminal.
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

  const isDegraded = state.kind === 'ok' && state.data.status === 'degraded';

  return (
    <section
      aria-labelledby="health-heading"
      className="w-full rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
    >
      <header className="mb-4 flex items-center gap-2">
        <Activity aria-hidden="true" className="size-5 text-primary" />
        <h2 id="health-heading" className="text-base font-semibold">
          API connection
        </h2>
      </header>

      <div aria-live="polite" className="min-h-40">
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
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Status</dt>
              <dd
                className={`flex items-center gap-1.5 font-medium ${
                  isDegraded ? 'text-destructive' : 'text-[var(--success)]'
                }`}
              >
                {isDegraded ? (
                  <AlertTriangle aria-hidden="true" className="size-4" />
                ) : (
                  <CheckCircle2 aria-hidden="true" className="size-4" />
                )}
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

            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Dependencies
              </h3>
              <DependencyRow name="MongoDB" health={state.data.dependencies.mongo} />
              <DependencyRow name="Redis" health={state.data.dependencies.redis} />
            </div>
          </div>
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
