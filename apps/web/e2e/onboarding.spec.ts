import { test, expect } from '@playwright/test';
import { resetPlatform, bootstrapAdmin } from './helpers';

/**
 * Onboarding: admin gateway, core UI, and the profile-modal edit flow.
 * Corresponds to the legacy A1.1 / A1.2 / A1.3 steps.
 */
test.describe('Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await resetPlatform(page);
  });

  test('admin can bootstrap the platform and lands in a usable shell', async ({ page }) => {
    await bootstrapAdmin(page);

    await expect(page.locator('.topbar-id')).toContainText('Signed in as admin');

    const generalChannel = page.getByTestId('channel-nav-item').filter({ hasText: '#general' });
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();
    await expect(page.locator('.channel-header h2')).toContainText('general', { timeout: 10000 });
  });

  test('admin can open their own profile and edit display name + bio', async ({ page }) => {
    await bootstrapAdmin(page);

    const generalChannel = page.getByTestId('channel-nav-item').filter({ hasText: '#general' });
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();
    await expect(page.locator('.timeline.panel')).toBeVisible({ timeout: 15000 });

    const composer = page.locator('textarea[placeholder*="Message"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });

    // Background realtime updates can race the input; retry if cleared.
    let typed = false;
    for (let i = 0; i < 3 && !typed; i++) {
      await composer.fill('Profile verification sequence initiated.');
      await page.waitForTimeout(500);
      typed = (await composer.inputValue()) === 'Profile verification sequence initiated.';
      if (!typed) await page.waitForTimeout(1000);
    }
    expect(typed, 'composer must stabilize with expected content').toBe(true);

    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled({ timeout: 15000 });
    await composer.press('Enter');

    const messageItem = page.locator('[data-testid="message-item"]').first();
    await expect(messageItem).toBeVisible({ timeout: 15000 });
    await messageItem.locator('.author-name').click();

    const modal = page.locator('.modal-card');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.username')).toContainText('@admin');

    await modal.getByRole('button', { name: 'Edit Profile' }).click();
    await modal.locator('input[placeholder="How should people see you?"]').fill('Skerry Admin');
    await modal.locator('textarea[placeholder="Tell us about yourself"]').fill('Automated Test bio.');
    await modal.getByRole('button', { name: 'Save Changes' }).click();

    await expect(modal.locator('h1')).toContainText('Skerry Admin');
    await expect(modal.locator('.bio-text')).toContainText('Automated Test bio.');
  });
});
