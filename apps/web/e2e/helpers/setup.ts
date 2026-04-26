import { expect, type Page } from '@playwright/test';
import { resetPlatform } from './reset';
import { bootstrapAdmin } from './auth';
import { backToServers, selectChannelByName } from './navigation';

/**
 * Creates a space (a.k.a. "server" in the UI) named `spaceName` and asserts
 * the page settles on its channels view.
 */
export async function createSpace(page: Page, spaceName: string): Promise<void> {
  await backToServers(page);

  // The servers rail can re-render once more as SSE state flushes right after
  // navigation; target the stable add-space-button testid to avoid detaches.
  const createBtn = page.getByTestId('add-space-button');
  await expect(createBtn).toBeVisible({ timeout: 10000 });
  await createBtn.click();

  const modal = page.locator('.modal-backdrop:has(.modal-panel)');
  await expect(modal).toBeVisible();
  await modal.locator('#space-name-modal').fill(spaceName);
  await modal.getByRole('button', { name: 'Create Space' }).click();

  await expect(page.locator('.server-title')).toContainText(spaceName, { timeout: 15000 });
}

/**
 * Creates a text channel (room) within the currently-selected space and
 * selects it. Waits for the channel header to show the new name.
 */
export async function createTextRoom(page: Page, roomName: string): Promise<void> {
  const addBtn = page.locator('nav.channels button[title="Add..."]');
  await addBtn.click();

  await page.locator('.add-menu-dropdown').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'New Room' }).click();

  await page.locator('#room-name-modal').fill(roomName);
  await page.getByRole('button', { name: 'Create Room' }).click();

  await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 15000 });

  await selectChannelByName(page, roomName);
  await expect(page.locator('.channel-header h2')).toContainText(roomName, { timeout: 15000 });
}

/**
 * Convenience: reset platform, bootstrap admin, and create a Playwright space
 * with a "Text Lab" channel ready for messaging/moderation tests.
 */
export async function bootstrapSpaceWithChannel(
  page: Page,
  options: { spaceName?: string; channelName?: string } = {}
): Promise<{ spaceName: string; channelName: string }> {
  const spaceName = options.spaceName ?? 'Playwright Server';
  const channelName = options.channelName ?? 'Text Lab';

  await resetPlatform(page);
  await bootstrapAdmin(page);
  await createSpace(page, spaceName);
  await createTextRoom(page, channelName);

  return { spaceName, channelName };
}
