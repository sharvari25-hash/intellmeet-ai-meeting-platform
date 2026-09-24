import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { signInAsDemo } from './helpers';

/**
 * The Phase 8 checkpoint: two browsers on the same board see each other's
 * changes live, and an action item becomes a task end to end.
 *
 * Both reviewers are demo guests on the shared, seeded demo board. Every task
 * here is created by one of them and is named "E2E ...", so the global
 * teardown's "end demo session" deletes it with its guest; the seeded sample
 * tasks are only looked at, never moved, so the board is left as found.
 */

/** A column of the board, found by its heading. */
const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

/**
 * Drags a card onto a column with the mouse, the way a person would.
 *
 * dnd-kit waits for a few pixels of movement before a drag starts (so a click
 * still opens the card), and needs intermediate moves to track the pointer,
 * hence the stepped moves rather than a jump.
 */
async function drag(page: Page, card: Locator, target: Locator): Promise<void> {
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Card or column is not on screen');

  await page.mouse.move(from.x + from.width / 2, from.y + 12);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + 24, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();
}

async function openBoard(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click();
  await page.waitForURL('**/app/tasks');
  await expect(column(page, 'To Do')).toBeVisible();
}

test.describe('the team board', () => {
  let firstContext: BrowserContext;
  let secondContext: BrowserContext;

  test.afterEach(async () => {
    await firstContext?.close();
    await secondContext?.close();
  });

  test('two reviewers see each other’s cards appear, move and gather comments live', async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    // Two separate cookie jars: two people, like two laptops.
    firstContext = await browser.newContext();
    secondContext = await browser.newContext();
    const ann = await firstContext.newPage();
    const ben = await secondContext.newPage();

    const annGuest = await signInAsDemo(ann);
    const benGuest = await signInAsDemo(ben);
    await openBoard(ann);
    await openBoard(ben);

    // The seeded board is populated before anyone does anything.
    await expect(column(ann, 'In Progress').getByRole('button', { name: /Move / })).not.toHaveCount(
      0,
    );

    // --- Created in one window, it appears in the other -------------------

    const title = `E2E board task ${Date.now()}`;
    await ann.getByRole('button', { name: 'Add a task to To Do' }).click();
    await ann.getByRole('textbox', { name: 'New task in To Do' }).fill(title);
    await ann.getByRole('textbox', { name: 'New task in To Do' }).press('Enter');

    await expect(
      column(ann, 'To Do').getByRole('button', { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      column(ben, 'To Do').getByRole('button', { name: title, exact: true }),
    ).toBeVisible();

    // --- Dragged in one window, it moves in the other ---------------------

    const card = column(ann, 'To Do').locator('li', {
      has: ann.getByRole('button', { name: title, exact: true }),
    });
    await drag(ann, card, column(ann, 'In Progress').getByRole('list'));

    await expect(
      column(ann, 'In Progress').getByRole('button', { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      column(ben, 'In Progress').getByRole('button', { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      column(ben, 'To Do').getByRole('button', { name: title, exact: true }),
    ).toHaveCount(0);

    // A reload shows the same: the move was saved, not only broadcast.
    await ben.reload();
    await expect(
      column(ben, 'In Progress').getByRole('button', { name: title, exact: true }),
    ).toBeVisible();

    // --- The other reviewer comments and mentions the author --------------

    await column(ben, 'In Progress').getByRole('button', { name: title, exact: true }).click();
    const dialog = ben.getByRole('dialog', { name: title });
    // Not theirs, so they cannot delete it.
    await expect(dialog.getByRole('button', { name: 'Delete task' })).toHaveCount(0);

    const firstName = annGuest.name.split(' ')[0] ?? annGuest.name;
    const comment = dialog.getByRole('textbox', { name: 'Add a comment' });
    await comment.fill(`@${firstName.slice(0, 3)}`);
    await dialog
      .getByRole('listbox', { name: 'People to mention' })
      .getByRole('option', { name: annGuest.name })
      .click();
    await comment.pressSequentially('can you take a look?');
    await dialog.getByRole('button', { name: 'Comment' }).click();
    await expect(dialog.getByText('can you take a look?')).toBeVisible();

    // The author's card shows the comment count, and their bell lights up.
    const annCard = column(ann, 'In Progress').locator('li', {
      has: ann.getByRole('button', { name: title, exact: true }),
    });
    await expect(annCard).toContainText('1 comment');
    const bell = ann.getByRole('button', { name: /Notifications, \d+ unread/ });
    await expect(bell).toBeVisible();
    await bell.click();
    await ann
      .getByRole('menuitem', { name: new RegExp(`${benGuest.name} mentioned you in “${title}”`) })
      .click();

    // The notification opens the task itself.
    await ann.waitForURL(/\/app\/tasks\?board=[a-f0-9]{24}&task=[a-f0-9]{24}/);
    const annDialog = ann.getByRole('dialog', { name: title });
    await expect(annDialog.getByText(`@${annGuest.name} can you take a look?`)).toBeVisible();
    // The author may delete their own task.
    await expect(annDialog.getByRole('button', { name: 'Delete task' })).toBeVisible();
  });

  test('an action item from a meeting becomes a task on the board', async ({ page }) => {
    await signInAsDemo(page);
    await page.goto('/app/meetings?q=sprint');
    await page.getByRole('link', { name: 'Sprint 14 planning' }).click();
    await page.getByRole('tab', { name: /Action items/ }).click();

    // One of the samples is already on the board, seeded.
    await expect(
      page.getByRole('link', { name: /^Open the task for “.+”, in In Progress$/ }),
    ).toBeVisible();

    // Any other item can become a task; its owner comes pre-filled from the AI.
    const create = page.getByRole('button', { name: /^Create a task for “/ }).first();
    const item = /“(.+)”/.exec((await create.getAttribute('aria-label')) ?? '')?.[1];
    if (!item) throw new Error('No action item left to turn into a task');
    await create.click();

    const dialog = page.getByRole('dialog', { name: 'Create a task' });
    await expect(dialog.getByRole('combobox', { name: /Assignee/ })).not.toHaveValue('');
    await dialog.getByRole('button', { name: 'Create task' }).click();

    // The item now points at its task, in the first column.
    const link = page.getByRole('link', { name: `Open the task for “${item}”, in To Do` });
    await expect(link).toBeVisible();
    await link.click();

    await page.waitForURL(/\/app\/tasks\?board=[a-f0-9]{24}&task=[a-f0-9]{24}/);
    const task = page.getByRole('dialog', { name: item });
    await expect(task.getByRole('link', { name: 'Sprint 14 planning' })).toBeVisible();
    await expect(task.getByRole('combobox', { name: 'Column' })).toHaveValue(/[a-f0-9]{24}/);
  });
});
