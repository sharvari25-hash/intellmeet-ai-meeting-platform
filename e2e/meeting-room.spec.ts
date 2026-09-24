import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { joinFromLobby, signInAsDemo, signInAsTeammate, startMeeting } from './helpers';

/**
 * Two browsers, one meeting.
 *
 * Separate `BrowserContext`s rather than two tabs: a context has its own
 * cookie jar and its own storage, so each one is genuinely a different signed-in
 * user. Two tabs would share the demo session and never exercise the mesh.
 *
 * This is a smoke test, not a media-quality test. It proves the parts that
 * only exist when two real browsers are involved - the handshake, the roster,
 * the peer connection reaching `connected`, frames actually decoding in each
 * remote tile, and chat crossing between them - which unit tests with a fake
 * `RTCPeerConnection` cannot.
 */

/**
 * How long two browsers on one machine may take to connect and decode video.
 *
 * Measured at 0.7-1.6s. Deliberately below `CONNECT_WATCHDOG_MS` (5s) in
 * MeshTransport: a join that stalls and is only rescued by the watchdog still
 * fails here, instead of hiding as a test that is merely a bit slow.
 */
const CONNECT_WITHIN_MS = 4_500;

declare global {
  interface Window {
    __peerConnections?: RTCPeerConnection[];
  }
}

/**
 * Records every RTCPeerConnection the page creates.
 *
 * Lets the test ask the browser itself whether ICE connected, rather than
 * inferring it from the UI. Installed before any page script runs, so the app
 * constructs the subclass without knowing.
 */
async function recordPeerConnections(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const created: RTCPeerConnection[] = [];
    window.__peerConnections = created;

    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        created.push(this);
      }
    };
  });
}

/**
 * Asserts real media is flowing into this page: its one live peer connection
 * reached `connected`, and every remote <video> has decoded a frame.
 *
 * `videoWidth` is zero until a frame has actually been decoded, so it is the
 * difference between "a tile exists" and "you can see the other person".
 */
async function expectLiveVideo(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window.__peerConnections ?? [])
            .filter((pc) => pc.connectionState !== 'closed')
            .map((pc) => pc.connectionState),
        ),
      { timeout: CONNECT_WITHIN_MS },
    )
    .toEqual(['connected']);

  const remoteVideos = page.locator('video[data-tile="remote"]');
  await expect(remoteVideos).toHaveCount(1);
  await expect
    .poll(
      () =>
        remoteVideos.evaluateAll((videos) =>
          videos.every((video) => (video as HTMLVideoElement).videoWidth > 0),
        ),
      { timeout: CONNECT_WITHIN_MS },
    )
    .toBe(true);

  // ...and the tile has stopped saying it is waiting.
  await expect(page.getByText('Connecting…')).toHaveCount(0);
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
    await recordPeerConnections(hostContext);
    await recordPeerConnections(guestContext);

    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    // --- The host creates a meeting and joins -------------------------------

    await signInAsDemo(host);

    const roomCode = await startMeeting(host, 'E2E smoke test');
    await joinFromLobby(host);
    await expect(host.getByRole('heading', { name: 'E2E smoke test' })).toBeVisible();

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

    // ...and the remote one is actually playing, in both directions.
    await expectLiveVideo(host);
    await expectLiveVideo(guest);

    // Toggling the microphone must not rebuild the connection. It once left
    // and rejoined the room, which would show up here as a second connection.
    await guest.getByRole('button', { name: 'Turn your microphone off' }).click();
    await expect(host.getByLabel('Ada Lovelace is muted')).toBeVisible();
    await expectLiveVideo(guest);
    expect(await guest.evaluate(() => window.__peerConnections?.length)).toBe(1);

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

    await startMeeting(host, 'E2E controls test');
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
