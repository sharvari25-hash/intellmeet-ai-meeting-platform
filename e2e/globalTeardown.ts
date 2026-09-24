/**
 * Deletes the meetings the suite created.
 *
 * Every spec signs in as the shared demo account, so without this each run
 * leaves a few "E2E ..." meetings on the dashboard every reviewer sees - which
 * is exactly how the local workspace had accumulated seventy of them. Specs
 * name their meetings with an `E2E ` prefix; this removes those and nothing
 * else, ending any a failed run left live first (a live meeting cannot be
 * deleted).
 *
 * Goes through the public API rather than the database, so it exercises the
 * same authorisation a user would and needs no Mongo connection string.
 */

export const E2E_TITLE_PREFIX = 'E2E ';

const API = process.env.E2E_API_URL ?? 'http://localhost:5000/api';

interface MeetingRow {
  id: string;
  title: string;
  status: 'scheduled' | 'live' | 'ended';
}

export default async function globalTeardown(): Promise<void> {
  try {
    const auth = await fetch(`${API}/auth/demo`, { method: 'POST' });
    if (!auth.ok) throw new Error(`demo sign-in returned ${auth.status}`);
    const { accessToken } = (await auth.json()) as { accessToken: string };
    const headers = { Authorization: `Bearer ${accessToken}` };

    const ours: MeetingRow[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const response = await fetch(`${API}/meetings?limit=50&page=${page}`, { headers });
      if (!response.ok) break;
      const { meetings } = (await response.json()) as { meetings: MeetingRow[] };
      ours.push(...meetings.filter((meeting) => meeting.title.startsWith(E2E_TITLE_PREFIX)));
      if (meetings.length < 50) break;
    }

    for (const meeting of ours) {
      if (meeting.status === 'live') {
        await fetch(`${API}/meetings/${meeting.id}/end`, { method: 'POST', headers });
      }
      await fetch(`${API}/meetings/${meeting.id}`, { method: 'DELETE', headers });
    }

    console.warn(`[e2e] removed ${ours.length} test meeting(s)`);
  } catch (error) {
    console.warn('[e2e] could not remove test meetings:', (error as Error).message);
  }
}
