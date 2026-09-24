import { expect, type Page } from '@playwright/test';

/**
 * Steps shared by every spec: signing in as the seeded accounts, starting a
 * meeting and walking the lobby.
 */

export const DEMO_TEAMMATE = { email: 'ada@intellmeet.app', password: 'DemoPassword123' };

/** The seeded team both accounts belong to. */
export const DEMO_TEAM = 'IntellMeet Demo Team';

/**
 * Signs in through the landing page's demo button.
 *
 * Waits on the URL, not on a heading. The sign-in page's own h1 is "Welcome
 * back" too, so asserting on the text alone passes instantly while the request
 * is still in flight - and the next navigation then cancels it.
 */
export async function signInAsDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /try live demo/i })
    .first()
    .click();
  await page.waitForURL('**/app');
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
