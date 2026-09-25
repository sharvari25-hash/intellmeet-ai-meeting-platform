import { useSyncExternalStore } from 'react';

/**
 * Whether the person has asked their system for less motion.
 *
 * CSS transitions and animations already honour the setting everywhere
 * (`index.css`). This is for motion that script drives and a stylesheet cannot
 * reach: the charts' draw-in (Recharts) and a dropped card gliding into its
 * place on the board (dnd-kit, through the Web Animations API). Live: it
 * follows the setting if it changes while the page is open.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
