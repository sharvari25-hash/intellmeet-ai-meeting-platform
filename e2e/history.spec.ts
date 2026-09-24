import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { signInAsDemo } from './helpers';

/**
 * The Phase 7 checkpoint on the seeded sample meetings: history search
 * returns relevant meetings, explains each match, links into the transcript,
 * and the minutes export to a file that opens.
 *
 * Searches rather than scrolls: the demo workspace is shared, so which other
 * meetings are on page one depends on who used it last. Needs `npm run seed`
 * (the sample meetings and their chat).
 */

test('the seeded history is searchable, explains its matches, and exports', async ({ page }) => {
  await signInAsDemo(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Meetings' })
    .click();
  await page.waitForURL('**/app/meetings');

  const search = page.getByRole('searchbox', { name: 'Search meetings' });
  const row = (title: string) =>
    page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });

  // --- A title word: the row shows what the meeting produced ---------------

  await search.fill('sprint');
  const sprint = row('Sprint 14 planning');
  await expect(sprint).toBeVisible();
  await expect(sprint.getByText('4 action items, 4 open')).toBeVisible();
  await expect(sprint.getByText('2 decisions')).toBeVisible();

  // --- A word from a summary: the sentence, with the word marked -----------

  await search.fill('pricing');
  const retro = row('Q3 launch retrospective');
  await expect(retro).toBeVisible();
  await expect(retro.locator('mark', { hasText: 'pricing' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\?q=pricing$/);

  // The status filter narrows the same search.
  await page.getByRole('button', { name: 'Upcoming' }).click();
  await expect(page.getByText('Nothing matches “pricing”')).toBeVisible();
  await page.getByRole('button', { name: 'Past' }).click();
  await expect(retro).toBeVisible();

  // --- A word only ever spoken: a link to that moment ----------------------

  await search.fill('interviews');
  const design = row('Design review: meeting summary page');
  await expect(design.getByText(/Transcript 00:30/)).toBeVisible();
  await design.getByRole('link', { name: /Open the transcript of .+ at 00:30/ }).click();

  await expect(page).toHaveURL(/tab=transcript&t=30&q=interviews/);
  await expect(page.getByRole('searchbox', { name: 'Search the transcript' })).toHaveValue(
    'interviews',
  );
  await expect(page.locator('mark', { hasText: 'interviews' })).toBeVisible();

  // --- The rest of the sample meeting --------------------------------------

  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByText(/Interview notes behind the action-items-first point/)).toBeVisible();

  await page.getByRole('tab', { name: 'Summary' }).click();
  // A reviewer is a guest, not the sample's host, so the samples stay intact.
  await expect(page.getByRole('button', { name: 'Edit summary' })).toHaveCount(0);
  await expect(page.getByText('Only the host, Demo User, can correct')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Export' }).click();
      await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toBe('design-review-meeting-summary-page.md');
  const markdown = readFileSync(await download.path(), 'utf8');
  expect(markdown).toMatch(/^# Design review: meeting summary page\n/);
  expect(markdown).toContain('## Key decisions');
  expect(markdown).toMatch(/- \[ \] Run five usability sessions on the prototype \(Grace Hopper/);
});
