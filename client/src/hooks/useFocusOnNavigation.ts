import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * After an in-app navigation, focus on the new page's heading if the
 * navigation took focus away.
 *
 * A control that navigates ("Back to the dashboard" on the ended screen) goes
 * with the page it was on, and the browser drops focus to <body>. A keyboard
 * user is then nowhere: a screen reader announces nothing, and the next Tab
 * carries on from where the old control used to be. So once the new page has
 * its <h1>, focus goes there, as if the person had just arrived at it.
 *
 * Only when focus was lost. Focus that is somewhere real stays: on the
 * sidebar link that was pressed, in a dialog the new page opened, in a search
 * box whose query is in the URL (and only the path counts as a navigation).
 * The first page is left alone too, so Tab starts at the skip link as on any
 * page load.
 */
export function useFocusOnNavigation(containerRef: RefObject<HTMLElement | null>): void {
  const { pathname } = useLocation();
  const previousPathname = useRef(pathname);

  // A layout effect, so focus has moved before anything can read it: in the
  // gap before a passive effect, it would still be on <body>.
  useLayoutEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    const container = containerRef.current;
    if (!container) return;

    // True once there is nothing left to do: focus is somewhere, or on the heading.
    const settle = () => {
      if (document.activeElement && document.activeElement !== document.body) return true;
      const heading = container.querySelector('h1');
      if (!heading) return false;
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
      return true;
    };
    if (settle()) return;

    // The heading comes with the page's code or its data.
    const observer = new MutationObserver(() => {
      if (settle()) observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, containerRef]);
}
