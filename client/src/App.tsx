import { HealthCard } from '@/features/health/components/HealthCard';

/**
 * Phase 0 placeholder shell. Replaced in Phase 4 by the React Router tree
 * (public landing/auth routes + protected app routes).
 */
export default function App() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">IntellMeet</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground sm:text-base">
          AI-powered meetings: transcripts, summaries and action items, automatically.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">Phase 0 — scaffold &amp; tooling</p>
      </header>

      <HealthCard />
    </div>
  );
}
