import { test, expect } from '@playwright/test';
import {
  bootstrapSpaceWithChannel,
  loginAndOnboard,
  openDetailsDrawer,
  selectServerByInitial,
  backToServers,
} from './helpers';

/**
 * Invite generation + redemption flow. Legacy A3.1 / A3.2.
 */
test.describe('Invites', () => {
  test('admin generates an invite and Member B redeems it to join the space', async ({ page, browser }) => {
    test.setTimeout(90000);

    const { spaceName } = await bootstrapSpaceWithChannel(page, {
      spaceName: 'Playwright Server',
      channelName: 'Text Lab',
    });

    // --- Generate invite ---
    await openDetailsDrawer(page);
    const inviteBtn = page.getByTestId('create-hub-invite-button');
    await expect(inviteBtn).toBeVisible({ timeout: 15000 });
    await inviteBtn.click();

    const inviteModal = page.getByTestId('hub-invite-modal');
    await expect(inviteModal).toBeVisible({ timeout: 10000 });
    await expect(
      inviteModal.getByRole('heading', { name: /Create Hub Invite Link/i })
    ).toBeVisible();

    await inviteModal.getByRole('button', { name: 'Generate Invite Link' }).click();

    const inviteUrlInput = page.getByTestId('invite-url-input');
    await expect(inviteUrlInput).toHaveValue(/invite\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    const inviteUrl = await inviteUrlInput.inputValue();

    await page.getByTestId('copy-invite-url').click();
    await expect(
      page.locator('.toast-success').filter({ hasText: 'Link copied!' }).last()
    ).toBeVisible({ timeout: 5000 });

    await page.getByTestId('done-invite-modal').click();
    await expect(inviteModal).not.toBeVisible({ timeout: 8000 });

    // --- Member B redeems ---
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
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
        pageB.getByTestId('channel-nav-item').filter({ hasText: /#?general/i })
      ).toBeVisible({ timeout: 20000 });

      await backToServers(pageB);
      await expect(pageB.getByTestId('server-nav-item')).toHaveCount(2, { timeout: 25000 });

      await selectServerByInitial(pageB, 'P');
      await expect(pageB.locator('.server-title')).toHaveText(spaceName, { timeout: 15000 });
      await expect(
        pageB.getByTestId('channel-nav-item').filter({ hasText: /#?Text Lab/i })
      ).toBeVisible({ timeout: 15000 });
    } finally {
      await contextB.close();
    }
  });

  test('admin can view invite management table and revoke an invite', async ({ page }) => {
    test.setTimeout(60000);

    await bootstrapSpaceWithChannel(page, {
      spaceName: 'InviteMgmt Space',
      channelName: 'lobby',
    });

    // Generate an invite first
    await openDetailsDrawer(page);
    await page.getByTestId('create-hub-invite-button').click();
    const modal = page.getByTestId('hub-invite-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await modal.getByRole('button', { name: 'Generate Invite Link' }).click();
    await expect(page.getByTestId('invite-url-input')).toHaveValue(/invite\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    await page.getByTestId('done-invite-modal').click();

    // Navigate to invite management
    await page.goto('/settings/hub/invites');
    await expect(page.getByTestId('invite-management-table')).toBeVisible({ timeout: 15000 });

    // Revoke the invite
    const revokeBtn = page.getByTestId('revoke-invite-button').first();
    await expect(revokeBtn).toBeVisible({ timeout: 5000 });
    await revokeBtn.click();
    await expect(page.getByText(/No active invites/i)).toBeVisible({ timeout: 10000 });
  });

  test('logged-out user can view invite and is prompted to sign in', async ({ page, browser }) => {
    test.setTimeout(60000);

    await bootstrapSpaceWithChannel(page, {
      spaceName: 'Public Space',
      channelName: 'welcome',
    });

    // Generate invite from admin
    await openDetailsDrawer(page);
    await page.getByTestId('create-hub-invite-button').click();
    const modal = page.getByTestId('hub-invite-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await modal.getByRole('button', { name: 'Generate Invite Link' }).click();
    const inviteUrlInput = page.getByTestId('invite-url-input');
    await expect(inviteUrlInput).toHaveValue(/invite\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    const inviteUrl = await inviteUrlInput.inputValue();
    await page.getByTestId('done-invite-modal').click();

    // Logged-out context visits the invite
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(inviteUrl);
      await expect(guestPage.getByText(/invited|join/i)).toBeVisible({ timeout: 15000 });
    } finally {
      await guestContext.close();
    }
  });
});
