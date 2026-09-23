import { Construction } from 'lucide-react';

/**
 * Honest placeholder for a route that exists in the navigation but whose
 * feature lands in a later phase.
 *
 * The route is wired now so the shell, the guards and the layout are exercised
 * end to end; naming the phase keeps the placeholder from reading like a bug.
 */
export function ComingSoon({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-xl py-12 text-center">
      <Construction aria-hidden="true" className="mx-auto size-10 text-muted-foreground" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Arriving in <strong className="font-medium text-foreground">{phase}</strong>.
      </p>
      {children && <div className="mt-4 text-sm text-muted-foreground">{children}</div>}
    </section>
  );
}
