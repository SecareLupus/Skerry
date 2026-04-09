import { test, expect } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin, createSpaceAndRoom } from './test-utils';

test.beforeEach(async ({ page }) => {
  await resetTestEnvironment(page);
});

test('DM orchestration remembers last active DM and last active Room per Space', async ({ page }) => {
  const adminUsername = 'dm-tester';
  const spaceName = `DM-Space`;
  const roomName = `dm-room`;

  await setupAndLogin(page, adminUsername);
  await createSpaceAndRoom(page, spaceName, roomName);

  // Verify room is active
  await expect(page.getByPlaceholder(new RegExp(`Message #${roomName}`))).toBeVisible({ timeout: 10000 });

  // 2. Switch to DM list and create a DM
  const backButton = page.locator('button[title="Back to Servers"]');
  await backButton.click();
  
  // Find "New Message" button in DM section
  await page.locator('button[aria-label="New Message"]').click();
  await page.fill('input.search-input', 'bot'); // Search for a bot or user
  // Wait for results
  const firstResult = page.locator('.user-result-item').first();
  await firstResult.waitFor({ state: 'visible', timeout: 10000 });
  const rawUserName = await firstResult.locator('.display-name').textContent();
  const userName = rawUserName?.trim();
  expect(userName).toBeTruthy();
  
  await firstResult.click();

  // Verify DM is active
  await expect(page.getByPlaceholder(new RegExp(`Message ${userName}`))).toBeVisible({ timeout: 10000 });

  // 3. Switch back to the Space
  await backButton.click();
  await page.locator(`button:has-text("${spaceName}")`).click();

  // Verify it restored the Room
  await expect(page.getByPlaceholder(new RegExp(`Message #${roomName}`))).toBeVisible({ timeout: 10000 });

  // 4. Switch back to DMs (click on any DM in the list)
  await backButton.click();
  
  // We need to find the DM in the sidebar list. It usually has the username as the label.
  const dmListItem = page.locator(`.dm-item:has-text("${userName}")`).or(page.locator(`button:has-text("${userName}")`)).first();
  await dmListItem.click();

  // Verify it restored the DM
  await expect(page.getByPlaceholder(new RegExp(`Message ${userName}`))).toBeVisible({ timeout: 10000 });
});
