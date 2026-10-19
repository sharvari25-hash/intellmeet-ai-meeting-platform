import { useEffect, useState } from 'react';

/**
 * Whole seconds left until `deadline` (a `Date.now()` value), counting down
 * once a second and stopping at zero.
 *
 * Derived from the clock rather than decremented, so a throttled background
 * tab shows the right number the moment it wakes instead of resuming from
 * where it was paused. The interval keeps running after zero: it costs one
 * re-render of a small component a second, and lets a new deadline (another
 * code requested) start from a fresh `now` instead of one that went stale.
 */
export function useSecondsUntil(deadline: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
