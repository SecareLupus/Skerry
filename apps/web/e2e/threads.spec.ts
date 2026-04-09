import { test, expect } from '@playwright/test';
import { setupAndLogin } from './test-utils';

test('threaded messaging flow', async ({ page }) => {
  console.log('[test] Starting threaded messaging flow...');
  
  // 0. Setup and login
  await setupAndLogin(page);

  // 1. Send root message
  console.log('[test] Sending root message...');
  const rootContent = `Root Message ${Date.now()}`;
  await page.fill('textarea[placeholder*="Message #"]', rootContent);
  await page.keyboard.press('Enter');

  // Main chat uses .message-item-container
  const rootMessageLocator = page.locator('article.message-item-container', { hasText: rootContent }).first();
  await expect(rootMessageLocator).toBeVisible({ timeout: 15000 });

  // 2. Open thread panel via context menu
  console.log('[test] Opening thread panel via context menu...');
  await rootMessageLocator.click({ button: 'right' });
  
  const replyInThreadOption = page.locator('.context-menu button:has-text("Reply in Thread")');
  await expect(replyInThreadOption).toBeVisible({ timeout: 5000 });
  await replyInThreadOption.click();

  // 3. Verify thread panel is open
  console.log('[test] Verifying thread panel is open...');
  const threadPanel = page.locator('aside.thread-panel');
  await expect(threadPanel).toBeVisible({ timeout: 5000 });
  await expect(threadPanel.locator('h2')).toContainText('Thread');

  // 4. Send a threaded reply
  console.log('[test] Sending threaded reply...');
  const replyContent = `Threaded Reply ${Date.now()}`;
  
  // Target the thread panel's input specifically
  const threadInput = threadPanel.locator('textarea');
  await expect(threadInput).toBeVisible();
  await threadInput.fill(replyContent);
  await threadInput.press('Enter');

  // 5. Verify reply appears in thread panel
  // Thread panel uses .message-content for text paragraphs
  console.log(`[test] Waiting for reply visibility: ${replyContent}`);
  const threadedReply = threadPanel.locator('.message-content', { hasText: replyContent });
  await expect(threadedReply).toBeVisible({ timeout: 15000 });

  // 6. Verify reply count in main chat
  console.log('[test] Verifying reply count in main chat...');
  // The main chat shows the thread trigger button with the count
  const threadTrigger = page.locator('.thread-trigger-btn', { hasText: '1 reply' });
  await expect(threadTrigger).toBeVisible({ timeout: 15000 });

  // 7. Delete the reply and verify count updates
  console.log('[test] Deleting threaded reply...');
  await threadedReply.hover();
  
  // Open context menu for the reply in the thread panel
  const threadedReplyContainer = threadPanel.locator('article', { hasText: replyContent });
  await threadedReplyContainer.click({ button: 'right' });
  
  const deleteButton = page.locator('button:has-text("Delete Message")');
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  
  // Wait for the confirmation modal and click Delete
  const confirmDelete = page.locator('.modal-card button:has-text("Delete")');
  await expect(confirmDelete).toBeVisible();
  await confirmDelete.click();

  // Verify reply is gone from thread panel
  await expect(threadedReply).not.toBeVisible({ timeout: 15000 });

  // 8. Verify count is hidden or 0 in main chat
  console.log('[test] Verifying reply count removed from main chat...');
  await expect(threadTrigger).not.toBeVisible({ timeout: 15000 });

  console.log('[test] Threaded messaging flow passed successfully!');
});
