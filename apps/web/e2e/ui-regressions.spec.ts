import { test, expect } from '@playwright/test';
import { resetPlatform, bootstrapAdmin, loginAndOnboard } from './helpers';

// Regression tests for UI bugs:
// - Bug 1 (Phase 27): theme toggle button now flips data-theme on the document
//   element and stays flipped on a second toggle (prior bug: Effect 1 re-fired
//   on every render and overwrote the user's choice with stale localStorage).
// - Bug 5 (Phase 27): "+" New Direct Message button opens the picker modal
//   instead of crashing on `useChatHandlers must be used within a ChatHandlersProvider`.
// - #22 (Phase 25): when the Discord OAuth flow redirects back to the space
//   settings page with `?discordPendingSelection=…`, the BridgeManager section
//   scrolls itself into view so the freshly-rendered guild picker is visible
//   without manual scrolling.
test.describe('UI regressions', () => {
  test.beforeEach(async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
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

  test('Bug 5: "New Message" button opens the DM picker without a context error', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // bootstrapAdmin lands in channels view; navigate back to the
    // servers/DMs view where the "New Message" button lives.
    await page.getByTestId('back-to-servers').click();
    await page.getByRole('button', { name: 'New Message' }).click();

    // The modal renders a "New Direct Message" heading and a search input.
    await expect(page.getByRole('heading', { name: 'New Direct Message' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByPlaceholder('Type a username...')).toBeVisible();

    const providerError = consoleErrors.find((line) =>
      line.includes('useChatHandlers must be used within a ChatHandlersProvider')
    );
    expect(providerError, providerError).toBeUndefined();
  });

  test('#39: New DM modal renders preferred-username fallback and excludes self', async ({ page, browser }) => {
    // Seed a second identity in the DB by completing onboarding in a separate
    // context. Alice never joins the hub — she just needs an `identity_mappings`
    // row so that admin's user-search hits her. Onboarding sets only
    // preferred_username (display_name stays NULL), which is exactly the
    // situation that produced "Unknown User" rows in the modal pre-fix.
    const aliceContext = await browser.newContext();
    try {
      const alicePage = await aliceContext.newPage();
      await alicePage.goto('/');
      await loginAndOnboard(alicePage, 'alice-dev', 'alice');
      await alicePage.close();

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.getByTestId('back-to-servers').click();
      await page.getByRole('button', { name: 'New Message' }).click();
      await expect(page.getByRole('heading', { name: 'New Direct Message' })).toBeVisible({
        timeout: 5000,
      });

      // Type a query that matches BOTH alice and the admin (both have an "a"
      // in their preferred_username). Pre-fix, the admin would appear in their
      // own results and clicking would create a self-DM that errored downstream.
      await page.getByPlaceholder('Type a username...').fill('a');

      const aliceRow = page.locator('.user-result-item', { hasText: 'alice' });
      await expect(aliceRow).toBeVisible({ timeout: 5000 });

      // Self-exclusion: admin's own preferred_username ('admin') must not appear.
      await expect(page.locator('.user-result-item', { hasText: /^admin$/ })).toHaveCount(0);

      // Display-name fallback: alice has display_name=NULL, but the modal must
      // render her preferred_username, never the literal string "Unknown User".
      await expect(page.locator('.user-result-item', { hasText: 'Unknown User' })).toHaveCount(0);

      await aliceRow.click();

      // Modal closes and the DM is created. The sidebar's DMs section gets
      // populated with the new conversation. We don't assert specific UI here
      // beyond modal-dismissal + no console errors, since the surrounding DM
      // list reactivity is the subject of #35/#40.
      await expect(page.getByRole('heading', { name: 'New Direct Message' })).toBeHidden({
        timeout: 10000,
      });

      const dmFailures = consoleErrors.filter((line) =>
        /Failed to create DM|TypeError|Cannot read|undefined is not/.test(line)
      );
      expect(dmFailures, dmFailures.join('\n')).toEqual([]);
    } finally {
      await aliceContext.close();
    }
  });

  test('#22: OAuth return scrolls the BridgeManager into view', async ({ page }) => {
    // After bootstrapAdmin, the active server's id is persisted to
    // localStorage as `lastServerId` (see chat-client.tsx and
    // use-chat-initialization.ts). That's the most reliable way to
    // derive the bootstrap server's id without depending on URL shape
    // or DOM links that may not yet be mounted.
    const serverId = await page.evaluate(() => localStorage.getItem('lastServerId'));
    expect(serverId, 'could not derive serverId from localStorage').toBeTruthy();

    // Navigate as if we just returned from Discord's OAuth callback. The
    // pendingSelection ID is intentionally bogus — the API call will 404,
    // but the scroll-into-view fires from the same useEffect regardless,
    // before the API resolves.
    await page.goto(`/settings/spaces/${serverId}?discordPendingSelection=e2e-not-real#discord-bridge`);

    const bridgeSection = page.locator('#discord-bridge');
    await expect(bridgeSection).toBeVisible({ timeout: 10000 });

    // Assert it's actually in the viewport (and not just rendered off-screen).
    await expect
      .poll(
        async () =>
          bridgeSection.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return rect.top >= 0 && rect.top < window.innerHeight;
          }),
        { timeout: 5000 }
      )
      .toBe(true);
  });
});
