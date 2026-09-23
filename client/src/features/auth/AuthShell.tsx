import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * The frame both auth pages share: wordmark, heading, card, footer link.
 *
 * Keeping it here rather than duplicating the markup means the two pages
 * cannot drift apart visually, which is exactly what makes a sign-up flow
 * feel unfinished.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <Link
        to="/"
        className="flex items-center gap-2 font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-md bg-primary text-sm text-primary-foreground"
        >
          IM
        </span>
        IntellMeet
      </Link>

      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm">
        <div className="mb-6 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {children}
      </div>

      <p className="text-sm text-muted-foreground">{footer}</p>
    </main>
  );
}
