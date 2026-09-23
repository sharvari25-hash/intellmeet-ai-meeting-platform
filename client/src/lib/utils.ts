import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * `cn` is the class-name helper every shadcn/ui component expects:
 * clsx resolves conditional classes, tailwind-merge then removes conflicting
 * Tailwind utilities so a caller's `px-6` reliably beats a default `px-4`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
