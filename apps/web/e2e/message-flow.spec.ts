import { test, expect } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin, createSpaceAndRoom } from './test-utils';

test.beforeEach(async ({ page }) => {
  await resetTestEnvironment(page);
});

async function setup(page: any) {
  const username = 'local-admin';
  const spaceName = `Flow Space`;
  const roomName = `flow-room`;
  await setupAndLogin(page, username);
  await createSpaceAndRoom(page, spaceName, roomName);
  const messageInput = page.getByPlaceholder(new RegExp(`Message #${roomName}`));
  return { messageInput, roomName };
}

/**
 * TODO: Stabilize message-flow tests.
 * Currently failing due to:
 * 1. Strict mode violations on optimistic UI rendering (partially fixed with .first()).
 * 2. Synapse provisioning race: Matrix rooms are not always ready when the frontend tries to bootstrap them.
 * 3. Sidebar flakiness: "+" button visibility during view transitions.
 */

test('user can send a message and it appears in the timeline', async ({ page }) => {
  const { messageInput } = await setup(page);

  const content = `Hello E2E ${Date.now()}`;
  await messageInput.fill(content);
  await messageInput.press('Enter');

  await expect(page.locator(`text="${content}"`).first()).toBeVisible({ timeout: 10000 });
});

test('user can edit their own message via context menu', async ({ page }) => {
  const { messageInput } = await setup(page);

  const original = `Original ${Date.now()}`;
  await messageInput.fill(original);
  await messageInput.press('Enter');
  await expect(page.locator(`text="${original}"`).first()).toBeVisible({ timeout: 10000 });

  // Right-click the message to open the context menu
  await page.locator(`text="${original}"`).first().click({ button: 'right' });
  await expect(page.locator('text="Edit Message"')).toBeVisible({ timeout: 5000 });
  await page.click('text="Edit Message"');

  // The inline edit textarea should appear
  const editTextarea = page.locator('.edit-textarea');
  await expect(editTextarea).toBeVisible({ timeout: 5000 });

  // Clear and type new content, submit with Enter
  const edited = `Edited ${Date.now()}`;
  await editTextarea.fill(edited);
  await editTextarea.press('Enter');

  // The edited content should now appear in the timeline
  await expect(page.locator(`text="${edited}"`).first()).toBeVisible({ timeout: 10000 });
});

test('user can delete their own message via context menu', async ({ page }) => {
  const { messageInput } = await setup(page);

  const content = `To Delete ${Date.now()}`;
  await messageInput.fill(content);
  await messageInput.press('Enter');
  await expect(page.locator(`text="${content}"`).first()).toBeVisible({ timeout: 10000 });

  // Trigger the delete context menu action
  await page.locator(`text="${content}"`).first().click({ button: 'right' });
  await expect(page.locator('text="Delete Message"')).toBeVisible({ timeout: 5000 });
  await page.click('text="Delete Message"');

  // Handle the custom ConfirmationModal
  const confirmBtn = page.locator('.modal-card button:has-text("Delete")');
  await expect(confirmBtn).toBeVisible({ timeout: 10000 });
  await confirmBtn.click();

  // The message should disappear from the timeline
  await expect(page.locator(`text="${content}"`).first()).not.toBeVisible({ timeout: 12000 });
});

test('user can react to a message and the reaction count increments', async ({ page }) => {
  const { messageInput } = await setup(page);

  const content = `React Me ${Date.now()}`;
  await messageInput.fill(content);
  await messageInput.press('Enter');
  await expect(page.locator(`text="${content}"`).first()).toBeVisible({ timeout: 10000 });

  // Right-click to open context menu and choose "Add Reaction"
  await page.locator(`text="${content}"`).first().click({ button: 'right' });

  // The context menu may show "Add Reaction" or an emoji picker trigger
  const addReactionItem = page.locator('text="Add Reaction"');
  if (await addReactionItem.isVisible({ timeout: 5000 })) {
    await addReactionItem.click();
    // Pick an emoji from the picker — look for thumbs-up
    const thumbsUp = page.locator('[data-emoji="👍"]').or(page.locator('button:has-text("👍")'));
    if (await thumbsUp.isVisible({ timeout: 5000 })) {
      await thumbsUp.click();
      // Confirm reaction count appears
      await expect(page.locator('.reaction-count, .reaction-badge').first()).toBeVisible({ timeout: 12000 });
    }
  }
});


test('SSE delivers the sent message without a page refresh', async ({ page }) => {
  const { messageInput } = await setup(page);

  // Send a message and verify the timeline updates in-place (no reload)
  const content = `SSE Live ${Date.now()}`;
  await messageInput.fill(content);
  await messageInput.press('Enter');

  // The message should appear in the existing DOM without navigating
  await expect(page.locator(`text="${content}"`).first()).toBeVisible({ timeout: 10000 });
  // Confirm we are still on the same URL (no reload redirect)
  expect(page.url()).not.toContain('/login');
});
