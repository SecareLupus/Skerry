import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSpaceWithChannel,
  loginAndOnboard,
  openDetailsDrawer,
  selectServerByInitial,
  selectChannelByName,
  waitForStatusLive,
} from './helpers';

/**
 * Moderation + permission gates. Legacy A5.x steps.
 */
test.describe('Moderation', () => {
  let pageB: Page;
  let pageBContext: any;

  test.beforeEach(async ({ page, browser }) => {
    const { channelName } = await bootstrapSpaceWithChannel(page);

    // Generate invite
    await openDetailsDrawer(page);
    await page.getByTestId('create-hub-invite-button').click();
    await page.getByTestId('hub-invite-modal').waitFor();
    await page.getByRole('button', { name: 'Generate Invite Link' }).click();
    const inviteUrlInput = page.getByTestId('invite-url-input');
    await expect(inviteUrlInput).toHaveValue(/invite\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    const inviteUrl = await inviteUrlInput.inputValue();
    await page.getByTestId('done-invite-modal').click();

    // Member B joins
    pageBContext = await browser.newContext();
    pageB = await pageBContext.newPage();
    await pageB.goto('/');
    await loginAndOnboard(pageB, 'local-member', 'member_b');
    await pageB.goto(inviteUrl);
    await expect(pageB.locator('.invite-card')).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pageB.waitForURL((url: URL) => new URL(url.toString()).pathname === '/', { timeout: 20000 }),
      pageB.getByRole('button', { name: 'Accept Invite & Join Hub' }).click(),
    ]);
    await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
    await expect(
      pageB.getByTestId('channel-nav-item').filter({ hasText: /#?general/i }).first()
    ).toBeVisible({ timeout: 20000 });

    // Both users land on Text Lab
    await selectServerByInitial(page, 'P');
    await selectChannelByName(page, channelName);
    await waitForStatusLive(page);

    await selectServerByInitial(pageB, 'P');
    await selectChannelByName(pageB, channelName);
    await waitForStatusLive(pageB);
  });

  test.afterEach(async () => {
    await pageBContext?.close();
  });

  test('permission gates: member cannot see admin-only UI', async ({ page }) => {
    await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });

    await expect(pageB.getByTestId('add-space-button')).not.toBeVisible();
    await expect(pageB.getByTestId('server-settings-button')).not.toBeVisible();

    // Attempt direct URL access to space settings
    const spaceId = new URL(page.url()).searchParams.get('server');
    if (spaceId) {
      await pageB.goto(`/settings/spaces/${spaceId}`);
      await expect(pageB.locator('h1')).not.toContainText('Space Settings', { timeout: 10000 });
    }
  });

  test('scoped kick and audit-log verification', async ({ page }) => {
    await page.bringToFront();
    await waitForStatusLive(page);

    await openDetailsDrawer(page);
    await expect(page.getByTestId('member-item')).not.toHaveCount(0, { timeout: 10000 });

    const memberItem = page.getByTestId('member-item').filter({ hasText: /member_b/i }).first();
    await expect(memberItem).toBeVisible({ timeout: 15000 });

    await memberItem.click({ button: 'right', force: true });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Moderate User/i }).click();

    await expect(page.getByTestId('moderation-modal')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('moderation-action-select').selectOption('kick');
    await page.locator('input[type="radio"][value="server"]').click();

    const reasonInput = page.getByTestId('moderation-reason-input');
    await reasonInput.click();
    await reasonInput.pressSequentially('E2E Test: Behavior violation', { delay: 50 });

    await page.getByTestId('confirm-moderation-button').click();
    await expect(memberItem).not.toBeVisible({ timeout: 15000 });

    // --- Audit log ---
    const spaceId = new URL(page.url()).searchParams.get('server');
    if (!spaceId) throw new Error(`Could not derive server id from URL: ${page.url()}`);

    await page.goto(`/settings/spaces/${spaceId}/audit-log`);
    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible({
      timeout: 15000,
    });

    await expect(
      page.locator('.audit-entry').filter({ hasText: /kick/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
