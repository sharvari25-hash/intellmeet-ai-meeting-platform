import { appendFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

/**
 * Steps shared by every spec: signing in as a demo guest or a seeded
 * team-mate, starting a meeting and walking the lobby.
 */

export const DEMO_TEAMMATE = { email: 'ada@intellmeet.app', password: 'DemoPassword123' };

/** The seeded team every demo guest and team-mate belongs to. */
export const DEMO_TEAM = 'IntellMeet Demo Team';

/** Names the file, set up by global setup, that records the run's guests. */
export const DEMO_GUESTS_FILE_ENV = 'E2E_DEMO_GUESTS_FILE';

/** The guest a "Try Live Demo" created, as far as a spec needs to know it. */
export interface DemoGuest {
  name: string;
  accessToken: string;
}

/**
 * Signs in through the landing page's demo button, which creates a new guest
 * account every time.
 *
 * The guest is recorded the moment the server answers, before anything else
 * can fail, so the global teardown deletes it (and the meetings it hosted)
 * however the test ends. Its access token lasts 15 minutes, longer than a
 * whole run, which is why no refresh cookie needs to be kept.
 *
 * Waits on the URL, not on a heading. The sign-in page's own h1 is "Welcome
 * back" too, so asserting on the text alone passes instantly while the request
 * is still in flight - and the next navigation then cancels it.
 */
export async function signInAsDemo(page: Page): Promise<DemoGuest> {
  await page.goto('/');

  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().endsWith('/api/auth/demo') && res.request().method() === 'POST',
    ),
    page
      .getByRole('button', { name: /try live demo/i })
      .first()
      .click(),
  ]);

  expect(response.status()).toBe(201);
  const body = (await response.json()) as { accessToken: string; user: { name: string } };
  const guest = { name: body.user.name, accessToken: body.accessToken };
  recordGuest(guest);

  await page.waitForURL('**/app');
  return guest;
}

function recordGuest(guest: DemoGuest): void {
  const file = process.env[DEMO_GUESTS_FILE_ENV];
  // Only unset when a spec runs without the configured global setup, in which
  // case the demo cleanup's TTL sweep is what removes the guest.
  if (file) appendFileSync(file, `${JSON.stringify(guest)}\n`);
}

/** Signs in as a seeded team-mate, so the two contexts are different people. */
export async function signInAsTeammate(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(DEMO_TEAMMATE.email);
  await page.getByLabel('Password').fill(DEMO_TEAMMATE.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app');
}

/**
 * Creates a live meeting in the seeded team and lands in its lobby.
 *
 * The team is selected by name rather than left on the default. The demo
 * account is shared and may well be in more than one team, and a meeting
 * created in the wrong one is invisible to the other participant - which is
 * a confusing way for this test to fail.
 */
export async function startMeeting(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: /new meeting/i }).click();
  await page.getByLabel('Team').selectOption({ label: DEMO_TEAM });
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: /start now/i }).click();

  // Creating a live meeting navigates straight into its lobby.
  await page.waitForURL(/\/app\/room\/[A-Z2-9]+$/);

  const roomCode = page.url().split('/').pop();
  if (!roomCode) throw new Error('No room code in the URL after creating a meeting');
  return roomCode;
}

/** Walks the lobby and lands in the live room. */
export async function joinFromLobby(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Join meeting' })).toBeEnabled();
  await page.getByRole('button', { name: 'Join meeting' }).click();
}
