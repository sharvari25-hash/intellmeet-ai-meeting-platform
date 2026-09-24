import { existsSync, readFileSync, rmSync } from 'node:fs';
import { DEMO_GUESTS_FILE_ENV, type DemoGuest } from './helpers';

/**
 * Deletes every demo guest the run created.
 *
 * Each "Try Live Demo" creates a guest account in the shared demo team, and
 * every meeting a spec starts is hosted by one. Ending a guest's session
 * (`DELETE /api/auth/demo`) removes the guest with the meetings it hosted, so
 * this one call per guest is the whole cleanup: without it each run would
 * leave its guests in the team's member list and its "E2E ..." meetings on the
 * dashboard every reviewer sees, until the demo sweep caught up hours later.
 *
 * Goes through the public API rather than the database, so it exercises the
 * same authorisation a user would and needs no Mongo connection string.
 */

const API = process.env.E2E_API_URL ?? 'http://localhost:5000/api';

export default async function globalTeardown(): Promise<void> {
  const file = process.env[DEMO_GUESTS_FILE_ENV];
  if (!file || !existsSync(file)) return;

  const guests = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DemoGuest);

  let removed = 0;
  for (const guest of guests) {
    try {
      const response = await fetch(`${API}/auth/demo`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${guest.accessToken}` },
      });
      if (response.ok) removed += 1;
      else console.warn(`[e2e] could not remove guest ${guest.name}: HTTP ${response.status}`);
    } catch (error) {
      console.warn(`[e2e] could not remove guest ${guest.name}:`, (error as Error).message);
    }
  }

  rmSync(file, { force: true });
  // A test runner's own output: the operator reading the terminal is the
  // audience, and there is no logger in this process.
  console.warn(`[e2e] removed ${removed} of ${guests.length} demo guest(s) and their meetings`);
}
