import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * shadcn/ui Textarea, styled to match `Input`.
 *
 * `field-sizing: content` lets it grow with what is typed in browsers that
 * support it, so a long summary is not edited through a keyhole; elsewhere it
 * is simply resizable.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none [field-sizing:content]',
        'placeholder:text-muted-foreground',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
