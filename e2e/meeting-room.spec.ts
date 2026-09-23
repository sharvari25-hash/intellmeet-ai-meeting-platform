import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Two browsers, one meeting.
 *
 * Separate `BrowserContext`s rather than two tabs: a context has its own
 * cookie jar and its own storage, so each one is genuinely a different signed-in
 * user. Two tabs would share the demo session and never exercise the mesh.
 *
 * This is a smoke test, not a media-quality test. It proves the parts that
 * only exist when two real browsers are involved - the handshake, the roster,
 * the peer connection reaching `connected`, and chat crossing between them -
 * which unit tests with a fake `RTCPeerConnection` cannot.
 */

const DEMO_TEAMMATE = { email: 'ada@intellmeet.app', password: 'DemoPassword123' };

/** The seeded team both accounts belong to. */
const DEMO_TEAM = 'IntellMeet Demo Team';

/**
 * Signs in through the landing page's demo button.
 *
 * Waits on the URL, not on a heading. The sign-in page's own h1 is "Welcome
 * back" too, so asserting on the text alone passes instantly while the request
 * is still in flight - and the next navigation then cancels it.
 */
async function signInAsDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: /try live demo/i })
    .first()
    .click();
  await page.waitForURL('**/app');
}

/** Signs in as a seeded team-mate, so the two contexts are different people. */
async function signInAsTeammate(page: Page): Promise<void> {
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
async function startMeeting(page: Page, title: string): Promise<string> {
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
async function joinFromLobby(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Join meeting' })).toBeEnabled();
  await page.getByRole('button', { name: 'Join meeting' }).click();
}

test.describe('meeting room', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;

  test.afterEach(async () => {
    await hostContext?.close();
    await guestContext?.close();
  });

  test('two people join the same room, see each other and exchange chat', async ({ browser }) => {
    hostContext = await browser.newContext();
    guestContext = await browser.newContext();

    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    // --- The host creates a meeting and joins -------------------------------

    await signInAsDemo(host);

    const roomCode = await startMeeting(host, 'Playwright smoke test');
    await joinFromLobby(host);
    await expect(host.getByRole('heading', { name: 'Playwright smoke test' })).toBeVisible();

    // --- The guest joins the same room by code ------------------------------

    await signInAsTeammate(guest);
    await guest.goto(`/app/room/${roomCode}`);
    await joinFromLobby(guest);

    // --- They can see each other --------------------------------------------

    // The roster is the socket layer; the tile is the mesh. Waiting on the
    // count proves the join broadcast reached the other browser.
    await expect(host.getByText('2 in the room')).toBeVisible();
    await expect(guest.getByText('2 in the room')).toBeVisible();

    // Two video elements each: their own tile plus the remote one.
    await expect(host.locator('video')).toHaveCount(2);
    await expect(guest.locator('video')).toHaveCount(2);

    // --- Chat crosses between them ------------------------------------------

    await host.getByRole('textbox', { name: 'Message' }).fill('Hello from the host');
    await host.getByRole('button', { name: 'Send message' }).click();

    await expect(guest.getByText('Hello from the host')).toBeVisible();

    // ...and back the other way, which also proves the guest's socket is live.
    await guest.getByRole('textbox', { name: 'Message' }).fill('Hello back');
    await guest.getByRole('button', { name: 'Send message' }).click();
    await expect(host.getByText('Hello back')).toBeVisible();

    // --- Leaving removes the tile -------------------------------------------

    await guest.getByRole('button', { name: /leave/i }).click();
    await expect(host.getByText('1 in the room')).toBeVisible();

    // Tidy up so the demo workspace is not left with a live meeting.
    await host.getByRole('button', { name: /end for all/i }).click();
  });

  test('the media controls change state and are reachable by name', async ({ browser }) => {
    hostContext = await browser.newContext();
    const host = await hostContext.newPage();

    await signInAsDemo(host);

    await startMeeting(host, 'Controls smoke test');
    await joinFromLobby(host);

    const muteButton = host.getByRole('button', { name: 'Turn your microphone off' });
    await expect(muteButton).toBeVisible();
    await muteButton.click();

    // The label flips to describe the new action, which is what a screen
    // reader announces.
    await expect(host.getByRole('button', { name: 'Turn your microphone on' })).toBeVisible();

    await host.getByRole('button', { name: /end for all/i }).click();
  });
});
