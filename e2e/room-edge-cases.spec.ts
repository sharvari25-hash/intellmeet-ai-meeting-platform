import { expect, test, type BrowserContext } from '@playwright/test';
import { joinFromLobby, signInAsDemo, signInAsTeammate, startMeeting } from './helpers';

/**
 * The meeting room's edge cases, in real browsers.
 *
 * - Two tabs of one browser: the same person twice would connect to
 *   themselves and echo, so the newer tab takes over and the older one says
 *   so. Tabs of one browser share localStorage, which is how the server tells
 *   them from a second device.
 * - The host leaving: asked whether to end the meeting or let it carry on;
 *   the others are told while the host is away.
 *
 * (A token that expires mid-meeting is covered where it can be made to happen
 * on demand: `client/src/lib/socket.test.ts`, against socket.io-client's own
 * behaviour, which was checked against the real library.)
 */

test.describe('meeting room edge cases', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;

  test.afterEach(async () => {
    await hostContext?.close();
    await guestContext?.close();
  });

  test('a second tab of the same browser takes the meeting over', async ({ browser }) => {
    hostContext = await browser.newContext();
    const firstTab = await hostContext.newPage();

    await signInAsDemo(firstTab);
    const roomCode = await startMeeting(firstTab, 'E2E two tabs');
    await joinFromLobby(firstTab);
    await expect(firstTab.getByText('1 in the room')).toBeVisible();

    // Same browser, same account, same room.
    const secondTab = await hostContext.newPage();
    await secondTab.goto(`/app/room/${roomCode}`);
    await joinFromLobby(secondTab);

    await expect(
      firstTab.getByRole('heading', { name: 'This meeting is open in another tab' }),
    ).toBeVisible();
    // Only one of them is in the call: nobody is connected to themselves.
    await expect(secondTab.getByText('1 in the room')).toBeVisible();
    await expect(secondTab.locator('video')).toHaveCount(1);

    // And back again, on request.
    await firstTab.getByRole('button', { name: 'Use this tab instead' }).click();
    await expect(firstTab.getByText('1 in the room')).toBeVisible();
    await expect(
      secondTab.getByRole('heading', { name: 'This meeting is open in another tab' }),
    ).toBeVisible();

    await firstTab.getByRole('button', { name: /end for all/i }).click();
  });

  test('the host is asked before leaving, and the others are told', async ({ browser }) => {
    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    const hostGuest = await signInAsDemo(host);
    const roomCode = await startMeeting(host, 'E2E host leaves');
    await joinFromLobby(host);

    await signInAsTeammate(guest);
    await guest.goto(`/app/room/${roomCode}`);
    await joinFromLobby(guest);
    await expect(host.getByText('2 in the room')).toBeVisible();
    await expect(guest.getByText(/the host, is not in the call/)).toHaveCount(0);

    await host.getByRole('button', { name: 'Leave' }).click();
    const question = host.getByRole('dialog', { name: 'Leave the meeting?' });
    await expect(question).toContainText('Somebody is still in the call');
    await question.getByRole('button', { name: 'Leave, let them carry on' }).click();

    // The meeting goes on without the host, and says so.
    await expect(guest.getByText('1 in the room')).toBeVisible();
    await expect(
      guest.getByText(`${hostGuest.name}, the host, is not in the call`, { exact: false }),
    ).toBeVisible();

    // The host comes back: the notice goes, the controls are theirs again.
    await host.goto(`/app/room/${roomCode}`);
    await joinFromLobby(host);
    await expect(guest.getByText('2 in the room')).toBeVisible();
    await expect(guest.getByText(/the host, is not in the call/)).toHaveCount(0);

    await host.getByRole('button', { name: 'Leave' }).click();
    await host
      .getByRole('dialog', { name: 'Leave the meeting?' })
      .getByRole('button', { name: 'End for everyone' })
      .click();
    await expect(guest.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible();
  });
});
