import { AlertTriangle } from 'lucide-react';
import { ApiError } from '@/lib/apiClient';

/**
 * Renders whatever a failed submission threw.
 *
 * `role="alert"` makes a screen reader announce the failure immediately, which
 * matters because the message appears above the submit button the user has
 * just pressed and moved past.
 *
 * Rate limiting gets its own wording: the raw "Too many requests" next to a
 * password field reads as "your password is wrong" to most people.
 */
export function FormError({ error }: { error: unknown }) {
  if (!error) return null;

  let message = 'Something went wrong. Please try again.';

  if (error instanceof ApiError) {
    message =
      error.code === 'RATE_LIMITED'
        ? 'Too many attempts. Wait a minute and try again.'
        : error.message;
  } else if (error instanceof Error && error.message) {
    message = error.message;
  }

  return (
    <p
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}
