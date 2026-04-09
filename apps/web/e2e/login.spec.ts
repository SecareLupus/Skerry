import { test, expect } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin, createSpaceAndRoom } from './test-utils';

test.beforeEach(async ({ page }) => {
  await resetTestEnvironment(page);
});

test('completes dev login and sends a message', async ({ page }) => {
  const uniqueUser = 'local-admin';
  const spaceName = `Test Space`;
  const roomName = `test-room`;

  await setupAndLogin(page, uniqueUser);
  await createSpaceAndRoom(page, spaceName, roomName);

  // Wait for the room to be active
  const messageInput = page.getByPlaceholder(new RegExp(`Message #${roomName}`));
  await expect(messageInput).toBeVisible({ timeout: 10000 });

  const testMessage = `Hello from Playwright - ${Date.now()}`;
  await messageInput.fill(testMessage);
  await messageInput.press('Enter');

  // Verify the message appears in the chat log
  await expect(page.locator(`text="${testMessage}"`)).toBeVisible();
});
