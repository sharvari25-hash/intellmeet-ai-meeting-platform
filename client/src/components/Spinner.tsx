import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A spinner with its own accessible label.
 *
 * The icon is hidden from assistive technology and the status role carries the
 * text, so a screen reader announces "Loading" once rather than describing an
 * SVG.
 */
export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-height centred spinner, used while the session is being restored. */
export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}
