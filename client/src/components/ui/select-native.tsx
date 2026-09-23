import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A styled native `<select>`.
 *
 * Deliberately not the Radix listbox. Device pickers are used on phones more
 * than anywhere else in this app, and a native select opens the platform's own
 * wheel or sheet - which is more usable, more accessible and several kilobytes
 * lighter than a custom listbox reimplementing keyboard and touch behaviour.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-9 w-full appearance-none rounded-md border border-input bg-transparent pl-3 pr-8 text-sm shadow-xs outline-none',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 opacity-60"
      />
    </div>
  );
}

export { NativeSelect };
