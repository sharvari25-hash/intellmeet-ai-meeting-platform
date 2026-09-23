import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A loading placeholder.
 *
 * `aria-hidden` is deliberate: a screen reader should hear the live region
 * that says "Loading…", not a description of grey rectangles.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
