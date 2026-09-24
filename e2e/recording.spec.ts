import { expect, test, type BrowserContext } from '@playwright/test';
import { joinFromLobby, signInAsDemo, signInAsTeammate, startMeeting } from './helpers';

/**
 * Record a meeting, end it, and watch the AI summary arrive.
 *
 * The Phase 6 checkpoint as a test. It needs the API running with the
 * in-process worker (the default) and `AI_PROVIDER=mock` (also the default):
 * the fake microphone's tone has no words in it, so a real speech model would
 * return an empty transcript, while the mock produces a deterministic meeting
 * that uses the real participants' names.
 *
 * Everything between "Stop recording" and "Summary" is real: MediaRecorder
 * encoding the Web Audio mix, the upload, BullMQ, the pipeline, the socket
 * status events and the page updating itself.
 */

test.describe('recording and AI summary', () => {
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;

  test.afterEach(async () => {
    await hostContext?.close();
    await guestContext?.close();
  });

  test('the host records, everyone sees it, and the summary appears after the meeting', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    hostContext = await browser.newContext();
    guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await signInAsDemo(host);
    const roomCode = await startMeeting(host, 'E2E recording test');
    await joinFromLobby(host);

    await signInAsTeammate(guest);
    await guest.goto(`/app/room/${roomCode}`);
    await joinFromLobby(guest);
    await expect(host.getByText('2 in the room')).toBeVisible();

    // --- Recording is visible to everyone -----------------------------------

    // Only the host is offered the control.
    await expect(guest.getByRole('button', { name: 'Record' })).toHaveCount(0);

    await host.getByRole('button', { name: 'Record' }).click();
    await expect(host.getByRole('button', { name: 'Stop recording' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(guest.getByRole('status').filter({ hasText: 'Recording' })).toBeVisible();

    // A few seconds of the fake devices' tone, so the file is not empty.
    await host.waitForTimeout(3_000);

    await host.getByRole('button', { name: 'Stop recording' }).click();
    await expect(host.getByText('Recording saved')).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByRole('status').filter({ hasText: 'Recording' })).toHaveCount(0);

    // --- End the meeting and follow the link to its page --------------------

    await host.getByRole('button', { name: /end for all/i }).click();
    await expect(guest.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible();

    await guest.getByRole('link', { name: 'Summary and action items' }).click();
    await guest.waitForURL(/\/app\/meetings\/[a-f0-9]{24}$/);

    // --- The pipeline finishes and the page fills itself in -----------------

    // No reload: the page updates from the socket's ai:status events.
    await expect(guest.getByRole('heading', { name: 'Summary' })).toBeVisible({ timeout: 30_000 });
    await expect(guest.getByRole('heading', { name: 'Key decisions' })).toBeVisible();
    await expect(guest.getByRole('heading', { name: 'Transcript' })).toBeVisible();

    // The mock names real participants, and they were matched to accounts.
    const actions = guest.locator('section', {
      has: guest.getByRole('heading', { name: 'Action items' }),
    });
    await expect(actions.getByText('Ada Lovelace').first()).toBeVisible();
    await expect(actions.getByText('(not a participant)')).toHaveCount(0);
  });
});
