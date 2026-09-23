/**
 * Where a freshly signed-in user should land.
 *
 * Two places need this answer and they must agree. `useOnSignedIn` navigates
 * as soon as the session exists, and `PublicOnlyRoute` redirects because a
 * signed-in user may no longer sit on /login. Both updates land in the same
 * React commit, so whichever runs second wins - and when the guard's answer
 * was a hardcoded `/app`, it quietly overwrote the destination the user had
 * actually asked for. An invite link was the visible casualty: the page
 * promised "you will join it automatically" and then dropped them on the
 * dashboard.
 *
 * Sharing one function makes the race harmless: both answers are identical.
 */
export function postAuthPath(state: unknown, pendingInvite: string | null): string {
  // An invite outranks the remembered page. Someone who followed an invite
  // link came here to join a team, and the join page sends them onward to it.
  if (pendingInvite) return `/join/${encodeURIComponent(pendingInvite)}`;

  const from = (state as { from?: { pathname?: string } } | null)?.from?.pathname;

  // Only a same-origin path from our own router state is honoured. The
  // second test is not redundant: `//evil.example` starts with a slash and is
  // a protocol-relative URL, so a lone `startsWith('/')` is an open redirect.
  if (from?.startsWith('/') && !from.startsWith('//')) return from;

  return '/app';
}
