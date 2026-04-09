import { test, expect } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin } from './test-utils';

test.beforeEach(async ({ page }) => {
  await resetTestEnvironment(page);
});

test('onboarding and hub invites flow', async ({ page }) => {
  const adminUsername = 'admin-user';

  // 1. Setup Admin and Hub
  await setupAndLogin(page, adminUsername);

  // 2. Open Hub Settings
  await page.locator('button[aria-label="Hub Settings"]').click();
  
  // 3. Click "Invite Users"
  await page.click('text="Invite Users"');
  
  // 4. Verify Invite Link Generation
  const inviteInput = page.locator('input[readonly]');
  await expect(inviteInput).toBeVisible({ timeout: 10000 });
  await expect(inviteInput).toHaveValue(/invite/);
  const inviteUrl = await inviteInput.inputValue();
  
  // 5. Close modal
  await page.click('button:has-text("Close")');
  
  // 6. Navigate to invite URL (Guest experience)
  await page.goto(inviteUrl);
  
  // 7. Verify Join Page
  await expect(page.locator('h1')).toContainText("You've been invited");
  await expect(page.locator('button:has-text("Join Hub")')).toBeVisible();
});
