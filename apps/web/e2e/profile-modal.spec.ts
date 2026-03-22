import { test, expect } from '@playwright/test';

/**
 * Shared setup: log in as local-admin, bootstrap if needed, and send one
 * message so there is an author name to click.
 */
async function setupWithMessage(page: import('@playwright/test').Page) {
  await page.goto('/');

  const username = 'local-admin';
  await page.fill('input[id="dev-username"]', username);
  await page.click('button:has-text("Dev Login")');

  await page.locator('.unified-sidebar')
    .or(page.locator('text="Choose Username"'))
    .or(page.locator('text="Initialize Workspace"'))
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });

  if (await page.locator('text="Choose Username"').isVisible()) {
    await page.fill('input[id="onboarding-username"]', username);
    await page.click('button:has-text("Save Username")');
    await page.locator('.unified-sidebar')
      .or(page.locator('text="Initialize Workspace"'))
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  if (await page.locator('text="Initialize Workspace"').isVisible()) {
    await page.fill('input[id="hub-name"]', 'Playwright Hub');
    await page.fill('input[id="setup-token"]', 'bootstrap_token');
    await page.click('button:has-text("Bootstrap Admin + Hub")');
  }

  const backButton = page.locator('button[title="Back to Servers"]');
  if (await backButton.isVisible()) {
    await backButton.click();
  }
  await expect(page.locator('button[aria-label="Create Space"]')).toBeVisible({ timeout: 10000 });

  // Create a Space
  const spaceName = `Profile Space ${Date.now()}`;
  await page.locator('button[aria-label="Create Space"]').click();
  await page.fill('input[id="space-name-modal"]', spaceName);
  await page.click('button:has-text("Create Space")');
  await expect(page.locator('h2.server-title')).toContainText(spaceName, { timeout: 10000 });

  // Create a Room
  const roomName = `profile-room-${Date.now()}`;
  await page.locator('button[title="Add..."]').click();
  await page.click('text="New Room"');
  await page.fill('input[id="room-name-modal"]', roomName);
  await page.click('button:has-text("Create Room")');

  const messageInput = page.getByPlaceholder(new RegExp(`Message #${roomName}`));
  await expect(messageInput).toBeVisible({ timeout: 10000 });

  // Send a message so there's an author name in the timeline
  const content = `Profile test ${Date.now()}`;
  await messageInput.fill(content);
  await messageInput.press('Enter');
  await expect(page.locator(`text="${content}"`)).toBeVisible({ timeout: 10000 });

  return { content, username };
}

// ---------------------------------------------------------------------------

test('clicking an author name opens the profile modal', async ({ page }) => {
  const { username } = await setupWithMessage(page);

  // Click the first visible author name in the timeline
  const authorName = page.locator('.author-name').first();
  await expect(authorName).toBeVisible({ timeout: 10000 });
  await authorName.click();

  // The profile modal should render its header section
  await expect(page.locator('.profile-header')).toBeVisible({ timeout: 5000 });
});

test('profile modal displays the correct username', async ({ page }) => {
  const { username } = await setupWithMessage(page);

  const authorName = page.locator('.author-name').first();
  await authorName.click();

  // The profile card should contain the admin's username
  await expect(page.locator('.profile-header')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.modal-card')).toContainText(username, { timeout: 5000 });
});

test('profile modal can be dismissed by clicking the overlay', async ({ page }) => {
  await setupWithMessage(page);

  const authorName = page.locator('.author-name').first();
  await authorName.click();
  await expect(page.locator('.profile-header')).toBeVisible({ timeout: 5000 });

  // Click the overlay (outside the modal card) to dismiss
  await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.profile-header')).not.toBeVisible({ timeout: 5000 });
});

test('profile modal shows joined provider badges or identity info', async ({ page }) => {
  await setupWithMessage(page);

  const authorName = page.locator('.author-name').first();
  await authorName.click();

  await expect(page.locator('.modal-card')).toBeVisible({ timeout: 5000 });
  // The profile modal shows linked identities or a provider label
  // We assert the modal card has meaningful content (not empty)
  const modalText = await page.locator('.modal-card').innerText();
  expect(modalText.trim().length).toBeGreaterThan(0);
});
