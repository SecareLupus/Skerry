import { test, expect } from '@playwright/test';
import { bootstrapAdmin } from './helpers';

// Regression tests for UI bugs fixed in BugFixesAndPolish:
// - Bug 1: theme toggle button now flips data-theme on the document element
// - Bug 5: "+" New Direct Message button opens the picker modal instead of
//   crashing on `useChatHandlers must be used within a ChatHandlersProvider`
test.describe('UI regressions', () => {
  test.beforeEach(async ({ page }) => {
    await bootstrapAdmin(page);
  });

  test('Bug 1: theme toggle flips data-theme and persists on a second toggle', async ({ page }) => {
    const initial = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(initial === 'light' || initial === 'dark').toBeTruthy();

    const toggleButton = page.getByRole('button', { name: /Switch to (Dark|Light) Mode/ });
    await toggleButton.click();

    await expect
      .poll(
        async () => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        { timeout: 5000 }
      )
      .toBe(initial === 'light' ? 'dark' : 'light');

    // Toggle back — exercises the dark→light path that was previously broken
    // by Effect 2's FOUC guard re-applying on every render.
    await toggleButton.click();
    await expect
      .poll(
        async () => page.evaluate(() => document.documentElement.getAttribute('data-theme')),
        { timeout: 5000 }
      )
      .toBe(initial);
  });

  test('Bug 5: "+" Direct Messages button opens the DM picker without a context error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.getByRole('button', { name: 'New Message' }).click();

    // The modal renders an "New Direct Message" heading and a search input.
    await expect(page.getByRole('heading', { name: 'New Direct Message' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByPlaceholder('Type a username...')).toBeVisible();

    const providerError = consoleErrors.find((line) =>
      line.includes('useChatHandlers must be used within a ChatHandlersProvider')
    );
    expect(providerError, providerError).toBeUndefined();
  });
});
