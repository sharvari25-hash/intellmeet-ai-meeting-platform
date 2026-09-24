import { expect, test, type BrowserContext } from '@playwright/test';
import { joinFromLobby, signInAsDemo, startMeeting } from './helpers';

/**
 * Two reviewers, both pressing "Try Live Demo".
 *
 * Every demo sign-in used to be the same seeded account, so the second
 * reviewer was also the host of the first one's meeting: they saw "End for
 * all", and the participant list showed "Demo User" twice. Each sign-in is now
 * a guest of its own, and this is the scenario that proves it end to end.
 */

test.describe('demo identity', () => {
  let firstContext: BrowserContext;
  let secondContext: BrowserContext;

  test.afterEach(async () => {
    await firstContext?.close();
    await secondContext?.close();
  });

  test('two demo sign-ins are two different people, and only one is the host', async ({
    browser,
  }) => {
    // Separate contexts: separate cookie jars, like two laptops or a private
    // window. (Two tabs of one profile would share the refresh cookie.)
    firstContext = await browser.newContext();
    secondContext = await browser.newContext();
    const first = await firstContext.newPage();
    const second = await secondContext.newPage();

    const host = await signInAsDemo(first);
    const other = await signInAsDemo(second);

    expect(other.name).not.toBe(host.name);
    await expect(
      first.getByRole('button', { name: `Account menu for ${host.name}` }),
    ).toBeVisible();
    await expect(
      second.getByRole('button', { name: `Account menu for ${other.name}` }),
    ).toBeVisible();

    // --- One meeting, two different people in it ---------------------------

    const roomCode = await startMeeting(first, 'E2E demo identity');
    await joinFromLobby(first);

    await second.goto(`/app/room/${roomCode}`);
    await joinFromLobby(second);

    await expect(first.getByText('2 in the room')).toBeVisible();
    await expect(second.getByText('2 in the room')).toBeVisible();

    // The host's controls belong to the host alone.
    await expect(first.getByRole('button', { name: /end for all/i })).toBeVisible();
    await expect(second.getByRole('button', { name: /end for all/i })).toHaveCount(0);

    // Each sees the other by their own name.
    await second.getByRole('tab', { name: /people/i }).click();
    await expect(second.getByText(host.name).first()).toBeVisible();

    await first.getByRole('button', { name: /end for all/i }).click();
    await expect(second.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible();
  });
});
