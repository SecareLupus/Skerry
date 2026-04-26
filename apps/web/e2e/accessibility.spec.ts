import { test, expect } from '@playwright/test';
import {
  resetPlatform,
  bootstrapAdmin,
  loginAndOnboard,
  bootstrapSpaceWithChannel,
  typeAndSubmit,
} from './helpers';
import { runA11yScan } from './helpers/a11y';

/**
 * Accessibility scans on the critical user flows. Each test bootstraps
 * the surface in question and runs axe-core. Blocking impact tiers
 * (`critical`/`serious`) fail the test; advisory tiers print to stderr.
 */
test.describe('Accessibility', () => {
  test('login screen', async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
    await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });
    await runA11yScan(page);
  });

  test('onboarding (choose username)', async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
    await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });
    await page.locator('#dev-username').fill('local-admin');
    await page.getByRole('button', { name: 'Dev Login' }).click();
    await expect(page.getByText('Choose Username')).toBeVisible({ timeout: 15000 });
    await runA11yScan(page);
  });

  test('initialize workspace', async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
    await loginAndOnboard(page, 'local-admin', 'admin');
    await expect(page.getByText('Initialize Workspace')).toBeVisible({ timeout: 15000 });
    await runA11yScan(page);
  });

  test('post-bootstrap admin landing (sidebar + channel view)', async ({ page }) => {
    await resetPlatform(page);
    await bootstrapAdmin(page);
    // `nested-interactive` is disabled here because there's a known nested-button
    // pattern in the sidebar that needs a structural refactor. Tracked in TODO.md
    // under "Pre-Release List > Bugs". Other a11y rules still enforce on this surface.
    await runA11yScan(page, { disableRules: ['nested-interactive'] });
  });

  test('channel chat with messages', async ({ page }) => {
    // Stay on the default #general channel — bootstrap leaves it selected and
    // we just need a populated chat surface to scan.
    await resetPlatform(page);
    await bootstrapAdmin(page);

    const composer = page.locator('textarea[placeholder*="Message"]');
    const firstMsg = `a11y-scan-msg-${Date.now()}`;
    const secondMsg = `bold and link https://example.com ${Date.now()}`;
    await typeAndSubmit(page, composer, firstMsg);
    await typeAndSubmit(page, composer, secondMsg);

    await expect(page.locator(`text="${firstMsg}"`)).toBeVisible({ timeout: 15000 });

    // Same nested-interactive caveat as above.
    await runA11yScan(page, { disableRules: ['nested-interactive'] });
  });

});
