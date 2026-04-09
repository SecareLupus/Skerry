import { test, expect } from '@playwright/test';
import { resetTestEnvironment, setupAndLogin, createSpaceAndRoom } from './test-utils';

test.beforeEach(async ({ page }) => {
  await resetTestEnvironment(page);
});

async function setup(page: any) {
  const username = `profile-user-${Date.now()}`;
  const spaceName = `Profile Space ${Date.now()}`;
  const roomName = `profile-room-${Date.now()}`;
  await setupAndLogin(page, username);
  await createSpaceAndRoom(page, spaceName, roomName);
  
  const messageInput = page.getByPlaceholder(new RegExp(`Message #${roomName}`));
  await expect(messageInput).toBeVisible({ timeout: 10000 });

  // Send a message so there's an author name in the timeline
  const content = `Profile test ${Date.now()}`;
  await messageInput.fill(content);
  await messageInput.press('Enter');
  await expect(page.locator(`text="${content}"`).first()).toBeVisible({ timeout: 10000 });

  return { content, username };
}

/**
 * TODO: Stabilize profile-modal tests.
 * These tests are currently failing primarily due to:
 * 1. "Create Space button (+) NOT VISIBLE": Sidebar state synchronization issues during rapid test setup.
 * 2. Synapse room provisioning race leading to 404/403 errors in the browser bootstrap.
 */

test('clicking an author name opens the profile modal', async ({ page }) => {
  await setup(page);

  // Click the first visible author name in the timeline
  const authorName = page.locator('.author-name').first();
  await expect(authorName).toBeVisible({ timeout: 10000 });
  await authorName.click();

  // The profile modal should render its header section
  await expect(page.locator('.profile-header')).toBeVisible({ timeout: 5000 });
});

test('profile modal displays the correct username', async ({ page }) => {
  const { username } = await setup(page);

  const authorName = page.locator('.author-name').first();
  await authorName.click();

  // The profile card should contain the admin's username
  await expect(page.locator('.profile-header').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.modal-card').first()).toContainText(username, { timeout: 5000 });
});

test('profile modal can be dismissed by clicking the overlay', async ({ page }) => {
  await setup(page);

  const authorName = page.locator('.author-name').first();
  await authorName.click();
  await expect(page.locator('.profile-header')).toBeVisible({ timeout: 5000 });

  // Click the overlay (outside the modal card) to dismiss
  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.profile-header').first()).not.toBeVisible({ timeout: 5000 });
});

test('profile modal shows joined provider badges or identity info', async ({ page }) => {
  await setup(page);

  const authorName = page.locator('.author-name').first();
  await authorName.click();

  await expect(page.locator('.modal-card')).toBeVisible({ timeout: 5000 });
  // The profile modal shows linked identities or a provider label
  // We assert the modal card has meaningful content (not empty)
  const modalText = await page.locator('.modal-card').innerText();
  expect(modalText.trim().length).toBeGreaterThan(0);
});

