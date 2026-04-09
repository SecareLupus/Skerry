import { test, expect, type Page } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin, createSpaceAndRoom } from './test-utils';

// We use serial to ensure tests run in order and share the same environment state.
test.describe.serial('Message Flow Sequences', () => {
  
  test.describe.serial('Message Lifecycle', () => {
    let sharedPage: Page;
    const roomName = 'flow-room';

    test.beforeAll(async ({ browser }) => {
      sharedPage = await browser.newPage();
      // Forward console logs for the shared page
      sharedPage.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') console.error(`[BROWSER ERROR] ${text}`);
        else if (msg.type() === 'warning') console.warn(`[BROWSER WARN] ${text}`);
      });

      await resetTestEnvironment(sharedPage);
      await setupAndLogin(sharedPage, 'local-admin');
      await createSpaceAndRoom(sharedPage, 'Flow Space', roomName);
    });

    test.afterAll(async () => {
      await sharedPage.close();
    });

    test('can send a message', async () => {
      const messageInput = sharedPage.getByPlaceholder(new RegExp(`Message #${roomName}`));
      const content = `Hello E2E ${Date.now()}`;
      await messageInput.fill(content);
      
      await Promise.all([
        sharedPage.waitForResponse(res => res.url().includes('/_matrix/client/v3/rooms') && res.url().includes('/send/m.room.message') && res.status() === 200),
        messageInput.press('Enter')
      ]);

      await expect(sharedPage.getByTestId('message-content').filter({ hasText: content }).first()).toBeVisible({ timeout: 10000 });
    });

    test('can edit the message', async () => {
      const content = `Target ${Date.now()}`;
      const messageInput = sharedPage.getByPlaceholder(new RegExp(`Message #${roomName}`));
      await messageInput.fill(content);
      await messageInput.press('Enter');

      const messageItem = sharedPage.getByTestId('message-item').filter({ hasText: content }).first();
      const messageContent = messageItem.getByTestId('message-content');
      await expect(messageContent).toBeVisible({ timeout: 10000 });

      await messageContent.click({ button: 'right' });
      await sharedPage.getByTestId('context-menu-item-edit-message').click();

      const editTextarea = sharedPage.locator('.edit-textarea');
      const edited = `Edited ${Date.now()}`;
      await editTextarea.fill(edited);
      
      await Promise.all([
        sharedPage.waitForResponse(res => res.url().includes('/send/m.room.message') && res.status() === 200),
        editTextarea.press('Enter')
      ]);

      await expect(sharedPage.getByTestId('message-content').filter({ hasText: edited }).first()).toBeVisible({ timeout: 10000 });
    });

    test('can react to the message', async () => {
      const content = `React ${Date.now()}`;
      const messageInput = sharedPage.getByPlaceholder(new RegExp(`Message #${roomName}`));
      await messageInput.fill(content);
      await messageInput.press('Enter');

      const messageItem = sharedPage.getByTestId('message-item').filter({ hasText: content }).first();
      const messageContent = messageItem.getByTestId('message-content');
      
      await messageContent.click({ button: 'right' });
      await sharedPage.getByTestId('context-menu-item-add-reaction').click();

      const thumbsUp = sharedPage.locator('.emoji-picker-container').locator('button:has-text("👍")').or(sharedPage.locator('.emoji-picker-container').locator('[data-emoji="👍"]'));
      await thumbsUp.click();

      await expect(messageItem.getByTestId('reaction-badge').first()).toBeVisible({ timeout: 10000 });
    });

    test('can delete the message', async () => {
      const content = `Delete ${Date.now()}`;
      const messageInput = sharedPage.getByPlaceholder(new RegExp(`Message #${roomName}`));
      await messageInput.fill(content);
      await messageInput.press('Enter');

      const messageItem = sharedPage.getByTestId('message-item').filter({ hasText: content }).first();
      const messageContent = messageItem.getByTestId('message-content');
      
      await messageContent.click({ button: 'right' });
      await sharedPage.getByTestId('context-menu-item-delete-message').click();

      const confirmBtn = sharedPage.locator('.modal-card button:has-text("Delete")');
      await confirmBtn.click();

      await expect(messageContent).not.toBeVisible({ timeout: 10000 });
    });
  });

  test.describe.serial('Realtime & Stability', () => {
    let sharedPage: Page;
    const roomName = 'realtime-room';

    test.beforeAll(async ({ browser }) => {
      sharedPage = await browser.newPage();
      await setupAndLogin(sharedPage, 'local-admin');
      await createSpaceAndRoom(sharedPage, 'Realtime Space', roomName);
    });

    test.afterAll(async () => {
      await sharedPage.close();
    });

    test('SSE delivers message without refresh', async () => {
      const messageInput = sharedPage.getByPlaceholder(new RegExp(`Message #${roomName}`));
      const content = `SSE ${Date.now()}`;
      await messageInput.fill(content);
      
      await Promise.all([
        sharedPage.waitForResponse(res => res.url().includes('/send/m.room.message') && res.status() === 200),
        messageInput.press('Enter')
      ]);

      await expect(sharedPage.getByTestId('message-content').filter({ hasText: content }).first()).toBeVisible({ timeout: 10000 });
      expect(sharedPage.url()).not.toContain('/login');
    });
  });
});
