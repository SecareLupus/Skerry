import { test, expect } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin, createSpaceAndRoom } from './test-utils';

test.beforeEach(async ({ page }) => {
  await resetTestEnvironment(page);
});

test('moderation UI and context menus', async ({ page }) => {
  const username = 'local-admin';
  const spaceName = `Mod Space ${Date.now()}`;
  const roomName = `mod-room-${Date.now()}`;

  console.log('[test] Setting up test environment...');
  await setupAndLogin(page, 'local-admin');
  await createSpaceAndRoom(page, spaceName, roomName);

  // 1. Open Member List (Details Pane) if not already open
  const detailsPane = page.locator('aside.context.panel.scrollable-pane');
  if (!await detailsPane.isVisible()) {
    console.log('[test] Opening details pane...');
    const memberListToggle = page.locator('button[title*="Member List"]');
    await memberListToggle.click();
  }
  
  // Wait for the Member List to be visible in the details drawer
  await expect(detailsPane).toBeVisible();

  // 2. Right-click yourself in the member list
  // The member list uses .member-item class based on chat-client.tsx
  const memberEntry = detailsPane.locator('.member-item').filter({ hasText: username }).first();
  await memberEntry.click({ button: 'right' });

  // 3. Verify User Context Menu appears
  const contextMenu = page.locator('.context-menu');
  await expect(contextMenu).toBeVisible();
  
  // Use "View Profile" as it is a standard item in use-moderation.ts
  await expect(contextMenu.locator('text="View Profile"')).toBeVisible();

  // 4. Click outside to close
  await page.click('body', { position: { x: 5, y: 5 } });
  await expect(contextMenu).not.toBeVisible();

  // 5. Send a message and right-click author
  const messageInput = page.locator('textarea[placeholder*="Message #"]');
  await expect(messageInput).toBeVisible();
  await messageInput.fill('Moderation test message');
  await messageInput.press('Enter');

  // Verify message appears
  const deployedMessage = page.locator('article.message-item-container').filter({ hasText: 'Moderation test message' }).first();
  await expect(deployedMessage).toBeVisible();

  const authorName = deployedMessage.locator('.author-name').filter({ hasText: username }).first();
  await authorName.click({ button: 'right' });
  await expect(contextMenu).toBeVisible();
  await expect(contextMenu.locator('text="View Profile"')).toBeVisible();

  // 6. Right-click message itself for message actions
  await deployedMessage.click({ button: 'right' });
  await expect(contextMenu.locator('text="Edit Message"')).toBeVisible();
  await expect(contextMenu.locator('text="Delete Message"')).toBeVisible();
});
