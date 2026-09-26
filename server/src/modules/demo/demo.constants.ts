/**
 * Facts about the seeded demo workspace that both the seed script and the
 * cleanup job have to agree on.
 *
 * They lived in `seed.ts` until the cleanup needed them too, and a second copy
 * of the team slug is exactly the kind of drift that makes a cleanup job
 * delete the thing it was meant to protect.
 */

export const DEMO_PASSWORD = 'DemoPassword123';

export const DEMO_TEAM_NAME = 'IntellMeet Demo Team';

/**
 * The seeded team is identified by slug rather than by id, because the seed is
 * idempotent and may have created it on a different machine or deploy. It is
 * defined in `shared` because the client needs it too: a meeting in this team
 * is one that anybody can join with Try Live Demo.
 */
export { DEMO_TEAM_SLUG } from '@intellmeet/shared';

export const DEMO_TEAMMATES = [
  { name: 'Ada Lovelace', email: 'ada@intellmeet.app', role: 'admin' as const },
  { name: 'Grace Hopper', email: 'grace@intellmeet.app', role: 'member' as const },
  { name: 'Alan Turing', email: 'alan@intellmeet.app', role: 'member' as const },
];
