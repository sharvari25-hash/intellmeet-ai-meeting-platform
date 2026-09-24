import { readFileSync } from 'node:fs';
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
 *
 * Then the Phase 7 checkpoint on the same meeting: the recording plays from
 * the transcript, the host corrects the summary and everyone sees it, and
 * both exports produce files that open.
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
    test.setTimeout(120_000);

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
    // Ada is not the host, so she is told who can correct it instead.
    await expect(guest.getByText(/Only the host, .+, can correct/)).toBeVisible();

    // The mock names real participants, and they were matched to accounts.
    await guest.getByRole('tab', { name: /Action items/ }).click();
    const actions = guest.getByRole('tabpanel');
    await expect(actions.getByText('Ada Lovelace').first()).toBeVisible();
    await expect(actions.getByText('(not a participant)')).toHaveCount(0);

    // The transcript's timestamps play the real recording from that moment.
    await guest.getByRole('tab', { name: 'Transcript' }).click();
    await expect(guest.getByRole('heading', { name: 'Transcript' })).toBeVisible();
    await guest.getByRole('button', { name: 'Play from 00:00' }).click();
    await expect
      .poll(() =>
        guest.getByLabel('Meeting recording').evaluate((audio) => {
          const element = audio as HTMLAudioElement;
          return element.readyState > 0 && !element.error;
        }),
      )
      .toBe(true);

    // --- The host corrects the AI and exports the minutes -------------------

    await expect(host.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible();
    await host.getByRole('link', { name: 'Summary and action items' }).click();
    await host.getByRole('button', { name: 'Edit summary' }).click();
    const summary = host.getByRole('textbox', { name: 'Summary' });
    await summary.fill('Corrected by the host: onboarding ships this week.');
    await host.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      host.getByText('Corrected by the host: onboarding ships this week.'),
    ).toBeVisible();
    await expect(host.getByText(/Edited by /)).toBeVisible();

    // Everyone else sees the correction, not the machine's version.
    await guest.reload();
    await guest.getByRole('tab', { name: 'Summary' }).click();
    await expect(
      guest.getByText('Corrected by the host: onboarding ships this week.'),
    ).toBeVisible();

    // Markdown: a real file, with the corrected text in it.
    const [markdown] = await Promise.all([
      host.waitForEvent('download'),
      (async () => {
        await host.getByRole('button', { name: 'Export' }).click();
        await host.getByRole('menuitem', { name: 'Markdown (.md)' }).click();
      })(),
    ]);
    expect(markdown.suggestedFilename()).toBe('e2e-recording-test.md');
    const markdownText = readFileSync(await markdown.path(), 'utf8');
    expect(markdownText).toMatch(/^# E2E recording test\n/);
    expect(markdownText).toContain('Corrected by the host: onboarding ships this week.');
    expect(markdownText).toContain('## Action items');
    expect(markdownText).toMatch(/`00:00` \*\*.+:\*\*/);

    // PDF: built in the browser; kept with the test's output for inspection.
    const [pdf] = await Promise.all([
      host.waitForEvent('download'),
      (async () => {
        await host.getByRole('button', { name: 'Export' }).click();
        await host.getByRole('menuitem', { name: 'PDF (.pdf)' }).click();
      })(),
    ]);
    expect(pdf.suggestedFilename()).toBe('e2e-recording-test.pdf');
    const pdfPath = test.info().outputPath('e2e-recording-test.pdf');
    await pdf.saveAs(pdfPath);
    const bytes = readFileSync(pdfPath);
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.subarray(-8).toString('latin1')).toContain('%%EOF');
  });
});
