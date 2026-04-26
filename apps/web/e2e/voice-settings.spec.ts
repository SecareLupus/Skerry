import { test, expect } from '@playwright/test';
import {
  resetPlatform,
  bootstrapAdmin,
  createSpace,
  waitForStatusLive,
} from './helpers';

/**
 * VoiceSettingsModal coverage. The modal only renders inside an active
 * VoiceRoom, so each test joins voice first. Cold-context Join Voice was
 * fixed in Phase 26 (lastServerId localStorage drift); see chat-client.tsx.
 *
 * Out of scope (intentional, see TODO):
 *   - Focus mode / Stage layout — requires 2+ participants with video on.
 *   - PiP — `requestPictureInPicture()` is unreliable in headless Chromium.
 *   - Reconnect — LiveKit reconnect timing is non-deterministic in tests.
 */
test.describe('Voice Settings Modal', () => {
  test.beforeEach(async ({ page }) => {
    await resetPlatform(page);
    await bootstrapAdmin(page);
    await createSpace(page, 'Voice Settings Server');

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
    await expect(page.locator('.channel-header h2')).toContainText(/Voice Lab/i, {
      timeout: 15000,
    });

    // Join voice
    await waitForStatusLive(page);
    await page.getByTestId('join-voice-btn').click();
    await expect(page.getByTestId('debug-voice-state')).toHaveAttribute(
      'data-voice-connected',
      'true',
      { timeout: 15000 }
    );
    await expect(page.locator('.voice-room')).toBeVisible({ timeout: 20000 });
  });

  test('settings button opens the Voice & Video Settings modal', async ({ page }) => {
    await page.getByTitle('Voice Settings').click();
    await expect(
      page.getByRole('heading', { name: 'Voice & Video Settings' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('modal renders Camera / Microphone / Audio Output dropdowns', async ({ page }) => {
    await page.getByTitle('Voice Settings').click();
    const modal = page.locator('.modal-panel', {
      has: page.getByRole('heading', { name: 'Voice & Video Settings' }),
    });

    await expect(modal.getByText('Camera', { exact: true })).toBeVisible();
    await expect(modal.getByText('Microphone', { exact: true })).toBeVisible();
    await expect(
      modal.getByText('Audio Output (Speakers)', { exact: true })
    ).toBeVisible();

    // Each select should at minimum have its "Default …" sentinel option.
    const selects = modal.locator('select');
    await expect(selects).toHaveCount(3);
    await expect(selects.nth(0)).toHaveValue(''); // Camera default
    await expect(selects.nth(1)).toHaveValue(''); // Mic default
    await expect(selects.nth(2)).toHaveValue(''); // Output default
  });

  test('Cancel closes the modal without reloading', async ({ page }) => {
    await page.getByTitle('Voice Settings').click();
    const modal = page.locator('.modal-panel', {
      has: page.getByRole('heading', { name: 'Voice & Video Settings' }),
    });
    await expect(modal).toBeVisible();

    // Sentinel that survives a same-document modal close but would NOT
    // survive a `window.location.reload()`.
    await page.evaluate(() => {
      (window as unknown as { __reloadSentinel?: boolean }).__reloadSentinel = true;
    });

    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    const sentinelStillSet = await page.evaluate(
      () => (window as unknown as { __reloadSentinel?: boolean }).__reloadSentinel === true
    );
    expect(sentinelStillSet).toBe(true);
  });

  test('Save & Apply persists selections to localStorage and reloads', async ({ page }) => {
    await page.getByTitle('Voice Settings').click();
    const modal = page.locator('.modal-panel', {
      has: page.getByRole('heading', { name: 'Voice & Video Settings' }),
    });
    await expect(modal).toBeVisible();

    // Default values are empty strings; click Save & Apply with defaults
    // and verify the keys are written. This still proves the persistence
    // path works without depending on faked-device labels (which Chromium
    // doesn't always populate in headless).
    await page.evaluate(() => {
      localStorage.removeItem('skerry_video_device');
      localStorage.removeItem('skerry_audio_in_device');
      localStorage.removeItem('skerry_audio_out_device');
      (window as unknown as { __reloadSentinel?: boolean }).__reloadSentinel = true;
    });

    await Promise.all([
      page.waitForEvent('framenavigated'),
      modal.getByRole('button', { name: 'Save & Apply' }).click(),
    ]);

    // After reload the sentinel is gone — proves the reload happened.
    const sentinelStillSet = await page.evaluate(
      () => (window as unknown as { __reloadSentinel?: boolean }).__reloadSentinel === true
    );
    expect(sentinelStillSet).toBe(false);

    // Persisted keys should now exist (with empty-string values for defaults).
    const stored = await page.evaluate(() => ({
      video: localStorage.getItem('skerry_video_device'),
      audioIn: localStorage.getItem('skerry_audio_in_device'),
      audioOut: localStorage.getItem('skerry_audio_out_device'),
    }));
    expect(stored.video).not.toBeNull();
    expect(stored.audioIn).not.toBeNull();
    expect(stored.audioOut).not.toBeNull();
  });
});
