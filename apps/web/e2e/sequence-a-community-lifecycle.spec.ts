import { test, expect } from '@playwright/test';

/**
 * Sequence A: Community Lifecycle
 * 
 * This test uses nested steps to maintain session state (browser cookies)
 * throughout the entire lifecycle while Providing granular reporting.
 */
test('Sequence A: Community Lifecycle', async ({ page }) => {
  
  // -- A1: Onboarding, Login, and Profile --
  await test.step('A1: Onboarding, Login, and Profile', async () => {

    await test.step('A1.1: Initial Provisioning (Login + Onboarding + Bootstrap)', async () => {
      await page.goto('/');
      
      // 1. Dev Login
      await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });
      await page.locator('#dev-username').fill('local-admin');
      await page.getByRole('button', { name: 'Dev Login' }).click();
      
      // 2. Username Onboarding
      await expect(page.getByText('Choose Username')).toBeVisible({ timeout: 15000 });
      await page.locator('#onboarding-username').fill('admin');
      await page.getByRole('button', { name: 'Save Username' }).click();
      
      // 3. Hub Bootstrap
      await expect(page.getByText('Initialize Workspace')).toBeVisible({ timeout: 15000 });
      await page.locator('#hub-name').fill('Skerry E2E Test Hub');
      await page.locator('#setup-token').fill('test_bootstrap_token');
      await page.getByRole('button', { name: 'Bootstrap Admin + Hub' }).click();
      
      // 4. Verify Shell
      await expect(page.locator('.sidebar-drawer-container')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.topbar-id')).toContainText('Signed in as admin');
    });

    await test.step('A1.2: Session Persistence', async () => {
      // Reload to ensure the session cookie survives a refresh
      await page.reload();
      await expect(page.locator('.topbar-id')).toContainText('Signed in as admin', { timeout: 10000 });
      await expect(page.locator('.sidebar-drawer-container')).toBeVisible();
    });

    await test.step('A1.3: User Profile Management', async () => {
      // Navigate to #general (should be pre-selected, but we'll ensure it)
      const generalChannel = page.locator('.list-item', { hasText: '#general' });
      await generalChannel.click();

      // Send a message to create a clickable author name
      const composer = page.locator('textarea[placeholder*="Message"]');
      await composer.fill('Profile test message');
      await page.keyboard.press('Enter');
      
      // Wait for the message to appear
      const messageItem = page.locator('[data-testid="message-item"]').first();
      await expect(messageItem).toBeVisible({ timeout: 10000 });
      
      // Click our own author name
      const authorName = messageItem.locator('.author-name');
      await authorName.click();
      
      // Verify Profile Modal
      const modal = page.locator('.modal-card');
      await expect(modal).toBeVisible();
      // Initially, h1 might be "User Profile" but the username should be "@admin"
      await expect(modal.locator('.username')).toContainText('@admin');
      
      // Update profile
      await modal.getByRole('button', { name: 'Edit Profile' }).click();
      await modal.locator('input[placeholder="How should people see you?"]').fill('Skerry Admin');
      await modal.locator('textarea[placeholder="Tell us about yourself"]').fill('Automated Test bio.');
      await modal.getByRole('button', { name: 'Save Changes' }).click();
      
      // Verify persistence in the modal
      await expect(modal.locator('h1')).toContainText('Skerry Admin');
      await expect(modal.locator('.bio-text')).toContainText('Automated Test bio.');
      
      // Close modal
      await modal.locator('.close-button').click();
      await expect(modal).not.toBeVisible();
    });

  });

  // Future steps for A2 and A3 can be added here
});
