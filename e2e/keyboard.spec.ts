import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEMO_TEAM, pressTryLiveDemo } from './helpers';

/**
 * The main flows with a keyboard and nothing else: no clicks, no fills.
 *
 * Every control is reached by pressing Tab, as a keyboard user would - so a
 * control that cannot be reached, or is reached only after an absurd number
 * of presses, fails the test - and each one must show where focus is when it
 * gets there. Text goes in by typing into whatever has focus.
 *
 * What it walks through: the skip link, "Try Live Demo", a new meeting from
 * the dashboard, the lobby, chat and a control in the room, ending it; then a
 * task created, opened and moved on the board, and the theme menu.
 */

const MAX_TABS = 60;

/**
 * Tabs to `target`, then checks the focus can be seen.
 *
 * Forward with Tab, or back with Shift+Tab when the target comes before the
 * focused element - as a keyboard user would, rather than going all the way
 * round the page.
 */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();

  const behind = await target.evaluate((element) => {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return Boolean(element.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  const key = behind ? 'Shift+Tab' : 'Tab';

  for (let presses = 0; presses <= MAX_TABS; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      await expectVisibleFocus(target);
      return;
    }
    await page.keyboard.press(key);
  }

  throw new Error(`${target.toString()} could not be reached in ${MAX_TABS} presses of ${key}`);
}

/** A ring (box-shadow) or an outline: something that shows where focus is. */
async function expectVisibleFocus(target: Locator): Promise<void> {
  const indicator = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
      ring: style.boxShadow !== 'none',
    };
  });
  expect(indicator.outline || indicator.ring, `${target.toString()} shows no focus indicator`).toBe(
    true,
  );
}

test('the main flows work with a keyboard alone', async ({ page }) => {
  // The whole app, one keystroke at a time: three times the usual ceiling.
  test.slow();

  // --- Landing: the skip link, then the demo --------------------------------

  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expectVisibleFocus(skip);

  // Past the header in one keystroke: the next Tab lands inside the page.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.locator('main :focus')).toHaveCount(1);

  const demo = page.getByRole('button', { name: /try live demo/i }).first();
  await tabTo(page, demo);
  await pressTryLiveDemo(page, () => page.keyboard.press('Enter'));

  // --- A meeting, started from the dashboard --------------------------------

  await tabTo(page, page.getByRole('button', { name: /new meeting/i }));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New meeting' });
  await expect(dialog).toBeVisible();
  // A new guest belongs to the demo team only, so it is already chosen.
  await expect(dialog.getByLabel('Team').locator('option:checked')).toHaveText(DEMO_TEAM);

  await tabTo(page, dialog.getByLabel('Title'));
  await page.keyboard.type('E2E keyboard meeting');
  await tabTo(page, dialog.getByRole('button', { name: /start now/i }));
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/app\/room\/[A-Z2-9]+$/);

  await tabTo(page, page.getByRole('button', { name: 'Join meeting' }));
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 in the room')).toBeVisible();

  // --- In the room ----------------------------------------------------------

  await tabTo(page, page.getByRole('textbox', { name: 'Message' }));
  await page.keyboard.type('Typed, not clicked');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Typed, not clicked')).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'Turn your microphone off' }));
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Turn your microphone on' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await tabTo(page, page.getByRole('button', { name: /end for all/i }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible();

  // --- The board: create, open and move a task ------------------------------

  await tabTo(page, page.getByRole('button', { name: 'Back to the dashboard' }));
  await page.keyboard.press('Enter');
  await page.waitForURL('**/app');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await tabTo(page, nav.getByRole('link', { name: 'Tasks' }));
  await page.keyboard.press('Enter');
  await page.waitForURL('**/app/tasks');

  const title = `E2E keyboard task ${Date.now()}`;
  await tabTo(page, page.getByRole('button', { name: 'Add a task to To Do' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'New task in To Do' })).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');

  const toDo = page.getByRole('region', { name: 'To Do', exact: true });
  const card = toDo.getByRole('button', { name: title, exact: true });
  await tabTo(page, card);
  await page.keyboard.press('Enter');

  // The column picker is the keyboard way to move a task (a drag is the
  // pointer way). The next column after To Do is In Progress.
  const task = page.getByRole('dialog', { name: title });
  const column = task.getByRole('combobox', { name: 'Column' });
  await tabTo(page, column);
  await page.keyboard.press('ArrowDown');
  await expect(column.locator('option:checked')).toHaveText('In Progress');
  await page.keyboard.press('Escape');
  await expect(task).toBeHidden();

  await expect(
    page
      .getByRole('region', { name: 'In Progress', exact: true })
      .getByRole('button', { name: title, exact: true }),
  ).toBeVisible();

  // --- The theme menu -------------------------------------------------------

  await tabTo(page, page.getByRole('button', { name: /Change theme/ }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  // Opening a menu from the keyboard puts focus on its first item.
  await expect(page.getByRole('menuitem', { name: 'Light' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Dark' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  // Focus goes back to the button that opened the menu.
  await expect(page.getByRole('button', { name: /Change theme/ })).toBeFocused();
});
