import { test, expect } from '@playwright/test';
import {
  resetPlatform,
  bootstrapAdmin,
  createSpace,
} from './helpers';

/**
 * Voice channel UI tests that DON'T require joining a LiveKit room.
 *
 * Phase 26 has a known cold-context bug where clicking "Join Voice" from a
 * fresh page redirects back to the home hub's #general (see
 * `community.spec.ts` `test.fixme`). Until that's fixed, anything that
 * depends on a successful join — VoiceSettingsModal (only renders inside an
 * active VoiceRoom), camera preview, focus mode, PiP, reconnect — can't run
 * deterministically.
 *
 * What we CAN test here is the pre-join surface: voice channel creation,
 * routing, header rendering, and the "Join Voice" affordance.
 */
test.describe('Voice Channel (pre-join)', () => {
  test.beforeEach(async ({ page }) => {
    await resetPlatform(page);
    await bootstrapAdmin(page);
    await createSpace(page, 'Voice Test Server');
  });

  test('create voice room: appears in channel list', async ({ page }) => {
    await page.locator('nav.channels button[title="Add..."]').click();
    await page.locator('.add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Room' }).click();

    await page.locator('#room-name-modal').fill('Voice Lab');
    await page.locator('#room-type-modal').selectOption('voice');
    await page.getByRole('button', { name: 'Create Room' }).click();

    await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 15000 });

    const voiceRoom = page
      .getByTestId('channel-nav-item')
      .filter({ hasText: /Voice Lab/i });
    await expect(voiceRoom).toBeVisible({ timeout: 15000 });
  });

  test('selecting voice room shows pre-join state with Join Voice button', async ({ page }) => {
    // Create + select voice room
    await page.locator('nav.channels button[title="Add..."]').click();
    await page.locator('.add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Room' }).click();
    await page.locator('#room-name-modal').fill('Voice Lab');
    await page.locator('#room-type-modal').selectOption('voice');
    await page.getByRole('button', { name: 'Create Room' }).click();
    await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 15000 });

    const voiceRoom = page
      .getByTestId('channel-nav-item')
      .filter({ hasText: /Voice Lab/i });
    await voiceRoom.click();

    // Channel header reflects the voice room.
    await expect(page.locator('.channel-header h2')).toContainText(/Voice Lab/i, {
      timeout: 15000,
    });

    // Debug marker confirms the channel is typed `voice` and we're not yet
    // connected — the Join Voice affordance should be visible.
    const debugMarker = page.getByTestId('debug-voice-state');
    await expect(debugMarker).toHaveAttribute('data-type', 'voice', { timeout: 10000 });
    await expect(debugMarker).toHaveAttribute('data-voice-connected', 'false', {
      timeout: 10000,
    });

    await expect(page.getByTestId('join-voice-btn')).toBeVisible({ timeout: 10000 });
  });

});
