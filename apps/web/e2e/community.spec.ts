import { test, expect } from '@playwright/test';
import { resetPlatform, bootstrapAdmin, createSpace, createTextRoom, waitForStatusLive } from './helpers';

/**
 * Community orchestration: space, category, text room, voice room creation.
 * Corresponds to the legacy A2.x steps.
 */
test.describe('Community Orchestration', () => {
  test.beforeEach(async ({ page }) => {
    await resetPlatform(page);
    await bootstrapAdmin(page);
  });

  test('admin can create a space, a category, and a text room', async ({ page }) => {
    await createSpace(page, 'Playwright Server');

    // Category
    await page.locator('nav.channels button[title="Add..."]').click();
    await page.locator('.add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Category' }).click();
    await page.locator('#category-name-modal').fill('Test Category');
    await page.getByRole('button', { name: 'Create Category' }).click();
    await expect(page.locator('.category-heading', { hasText: 'Test Category' })).toBeVisible({ timeout: 15000 });

    // Text room
    await createTextRoom(page, 'Text Lab');
  });

  test('admin can create and join a voice room', async ({ page }) => {
    await createSpace(page, 'Playwright Server');

    await page.getByTestId('add-channel-menu-trigger').click();
    await page.getByTestId('add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Room' }).click();

    await page.locator('#room-name-modal').fill('Voice Lab');
    await page.locator('#room-type-modal').selectOption('voice');
    await page.getByRole('button', { name: 'Create Room' }).click();
    await expect(page.getByTestId('modal-backdrop')).not.toBeVisible();

    const roomBtn = page.getByTestId('channel-nav-item').filter({ hasText: /Voice Lab/i });
    await expect(roomBtn).toBeVisible({ timeout: 15000 });
    await roomBtn.click();
    await expect(page.locator('.channel-header h2')).toContainText(/Voice Lab/i, { timeout: 15000 });

    const debugMarker = page.getByTestId('debug-voice-state');
    await expect(debugMarker).toHaveAttribute('data-type', 'voice', { timeout: 10000 });
    await expect(debugMarker).toHaveAttribute('data-voice-connected', 'false', { timeout: 10000 });

    // The voice-token request fails if SSE presence is not yet established.
    await waitForStatusLive(page);

    await page.getByTestId('join-voice-btn').click();

    await expect(debugMarker).toHaveAttribute('data-voice-connected', 'true', { timeout: 15000 });
    const detailsSidebar = page.locator('aside', { hasText: /Channel Details/i });
    await expect(detailsSidebar.getByText(/Status: Connected/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.voice-room')).toBeVisible({ timeout: 20000 });

    const adminCard = page.locator('.voice-room .participant-card', { hasText: /admin/i });
    await expect(adminCard).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Leave Voice' }).click();
    await expect(page.locator('.voice-room')).not.toBeVisible();
    await expect(detailsSidebar.getByText(/Status: Disconnected/i)).toBeVisible();
  });
});
