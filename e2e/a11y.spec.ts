import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { joinFromLobby, signInAsDemo, startMeeting } from './helpers';

/**
 * Automated accessibility checks: axe-core against every page and dialog a
 * reviewer can reach, in the light theme and in the dark one.
 *
 * WCAG 2.0 and 2.1, levels A and AA - which is what "colour contrast (AA)",
 * "every icon-only button has a name" and "every field has a label" come down
 * to. Each page is checked once its content has loaded (skeletons show no
 * text, so a contrast check on them would pass for nothing).
 *
 * Soft assertions: one run lists every violation on every page, rather than
 * stopping at the first. Each finding is also attached to the report as JSON.
 *
 * What axe cannot check - whether the page makes sense with a keyboard alone,
 * or whether focus is visible - is `keyboard.spec.ts`.
 */

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * With reduced motion the app's own rule (index.css) makes every transition
 * and animation effectively instant. Without it, a toast checked while it
 * fades in has its colours blended with the page behind it and fails a
 * contrast check it passes a moment later - and waiting for animations to
 * finish is no cure, because the lobby's microphone meter never stops moving.
 * The colours being checked are the same either way; this checks the
 * reduced-motion path of the app as a bonus.
 */
test.use({ reducedMotion: 'reduce' });

type Theme = 'light' | 'dark';

/** Waits until the page is what a person would read: content loaded, no skeletons. */
async function settled(page: Page): Promise<void> {
  // A modal dialog hides the page behind it from assistive technology, its
  // heading included, so an open dialog or menu counts as loaded too.
  await expect(
    page
      .getByRole('dialog')
      .or(page.getByRole('menu'))
      .or(page.getByRole('heading', { level: 1 }))
      .first(),
  ).toBeVisible();
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
}

async function audit(page: Page, name: string, theme: Theme): Promise<void> {
  await settled(page);
  // The theme is applied before the first paint (index.html); confirm it
  // took, or the dark run would silently audit the light theme twice.
  await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/);

  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  const findings = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target.join(' '),
      summary: node.failureSummary,
    })),
  }));

  if (findings.length > 0) {
    await test.info().attach(`axe ${theme} ${name}`, {
      body: JSON.stringify(findings, null, 2),
      contentType: 'application/json',
    });
  }

  const readable = findings
    .map(
      (finding) =>
        `${finding.rule} (${finding.impact}): ${finding.help}\n` +
        finding.nodes.map((node) => `    ${node.target}`).join('\n'),
    )
    .join('\n');
  expect.soft(findings, `${name} [${theme}]\n${readable}`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.beforeEach(async ({ context }) => {
      await context.addInitScript((value) => {
        localStorage.setItem('intellmeet-theme', value);
      }, theme);
    });

    test('the public pages', async ({ page }) => {
      await page.goto('/');
      await audit(page, 'landing', theme);

      await page.goto('/login');
      await audit(page, 'sign in', theme);

      await page.goto('/register');
      await audit(page, 'sign up', theme);

      await page.goto('/join/ABC234');
      await audit(page, 'invite link', theme);

      await page.goto('/does-not-exist');
      await audit(page, 'not found', theme);
    });

    test('the signed-in pages and dialogs', async ({ page }) => {
      // A dozen pages, each loaded and scanned: three times the usual ceiling.
      test.slow();
      await signInAsDemo(page);
      await audit(page, 'dashboard', theme);

      await page.getByRole('button', { name: /new meeting/i }).click();
      await expect(page.getByRole('dialog', { name: 'New meeting' })).toBeVisible();
      await audit(page, 'new meeting dialog', theme);
      await page.keyboard.press('Escape');

      await page.goto('/app/meetings');
      await expect(
        page.getByRole('region', { name: 'Results' }).getByRole('listitem').first(),
      ).toBeVisible();
      await audit(page, 'meetings', theme);

      // Found by search: the list is paginated, and every spec adds meetings
      // until the run's teardown, so a seeded one can be off the first page.
      await page.goto('/app/meetings?q=sprint');
      await page.getByRole('link', { name: 'Sprint 14 planning' }).click();
      await expect(page.getByRole('heading', { name: 'Key decisions' })).toBeVisible();
      await audit(page, 'meeting summary', theme);
      for (const tab of [/Action items/, 'Transcript', 'Chat']) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.getByRole('tabpanel')).toBeVisible();
        await audit(page, `meeting ${String(tab)} tab`, theme);
      }

      await page.goto('/app/tasks');
      await expect(page.getByRole('region', { name: 'To Do', exact: true })).toBeVisible();
      await audit(page, 'task board', theme);

      // A card's title opens it; the other button on a card is its drag handle.
      await page
        .getByRole('list', { name: 'In Progress tasks' })
        .getByRole('button', { name: /^(?!Move )/ })
        .first()
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit(page, 'task dialog', theme);
      await page.keyboard.press('Escape');

      await page.goto('/app/tasks?view=mine');
      await audit(page, 'my tasks', theme);

      await page.goto('/app/analytics');
      await expect(page.getByRole('heading', { name: 'Meetings per week' })).toBeVisible();
      await audit(page, 'analytics', theme);

      await page.goto('/app/teams');
      await audit(page, 'teams', theme);
      await page.getByRole('link', { name: 'IntellMeet Demo Team' }).click();
      await expect(page.getByRole('heading', { name: 'IntellMeet Demo Team' })).toBeVisible();
      await audit(page, 'team', theme);

      await page.goto('/app/settings');
      await audit(page, 'settings', theme);

      await page.goto('/app');
      await page.getByRole('button', { name: /Notifications/ }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await audit(page, 'notifications menu', theme);
      await page.keyboard.press('Escape');
    });

    test('the lobby and the meeting room', async ({ page }) => {
      await signInAsDemo(page);
      await startMeeting(page, `E2E a11y ${theme}`);
      await expect(page.getByRole('button', { name: 'Join meeting' })).toBeEnabled();
      await audit(page, 'lobby', theme);

      await joinFromLobby(page);
      await expect(page.getByText('1 in the room')).toBeVisible();
      await page.getByRole('textbox', { name: 'Message' }).fill('Checking the contrast');
      await page.getByRole('button', { name: 'Send message' }).click();
      await expect(page.getByText('Checking the contrast')).toBeVisible();
      await audit(page, 'meeting room', theme);

      await page.getByRole('tab', { name: 'People' }).click();
      await audit(page, 'meeting room, people', theme);

      await page.getByRole('button', { name: /end for all/i }).click();
      await expect(page.getByRole('heading', { name: 'The meeting has ended' })).toBeVisible();
      await audit(page, 'meeting ended', theme);
    });
  });
}
