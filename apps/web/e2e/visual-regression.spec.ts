import { test, expect } from '@playwright/test';
import {
  resetPlatform,
  bootstrapAdmin,
  loginAndOnboard,
  typeAndSubmit,
} from './helpers';

/**
 * Visual regression: pixel-diff snapshots of high-CSS-churn surfaces. First
 * run creates baselines under apps/web/e2e/__screenshots__/; subsequent runs
 * diff against them.
 *
 * Failures here are noisy — fonts, GPU, anti-aliasing, and platform all shift
 * pixels. Strategy:
 *   - Snapshot a focused selector, never the whole page.
 *   - Disable animations.
 *   - Mask volatile regions (timestamps, presence dots).
 *   - Tolerate small differences via the `maxDiffPixelRatio` option.
 *
 * To regenerate baselines after an intentional design change:
 *   pnpm --filter @skerry/web exec playwright test visual-regression.spec.ts --update-snapshots
 */
test.describe('Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    // Disable CSS animations + transitions so we don't capture mid-animation
    // frames.
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = `
        *, *::before, *::after {
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          transition-duration: 0s !important;
          transition-delay: 0s !important;
        }
      `;
      // Wait until DOM is ready so we can attach.
      const attach = () => document.head.appendChild(style);
      if (document.head) attach();
      else document.addEventListener('DOMContentLoaded', attach);
    });
  });

  test('login screen', async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
    await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });

    await expect(page.locator('.login-container')).toHaveScreenshot('login.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('onboarding (choose username) form', async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
    await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });
    await page.locator('#dev-username').fill('local-admin');
    await page.getByRole('button', { name: 'Dev Login' }).click();
    await expect(page.getByText('Choose Username')).toBeVisible({ timeout: 15000 });

    // Snapshot the onboarding card, not the full page.
    const card = page.locator('main, [data-testid="onboarding-card"], .onboarding').first();
    await expect(card).toHaveScreenshot('onboarding.png', { maxDiffPixelRatio: 0.02 });
  });

  test('initialize workspace form', async ({ page }) => {
    await resetPlatform(page);
    await page.goto('/');
    await loginAndOnboard(page, 'local-admin', 'admin');
    await expect(page.getByText('Initialize Workspace')).toBeVisible({ timeout: 15000 });

    const card = page.locator('main, .onboarding').first();
    await expect(card).toHaveScreenshot('initialize-workspace.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('post-bootstrap empty general channel', async ({ page }) => {
    await resetPlatform(page);
    await bootstrapAdmin(page);
    // Ensure the chat shell has settled.
    await expect(page.locator('textarea[placeholder*="Message"]')).toBeVisible({
      timeout: 15000,
    });

    // Snapshot the chat-window column (sidebar excluded — it has dynamic state
    // that adds noise).
    const chatColumn = page.locator('[data-testid="chat-window"], main, .chat-window').first();
    await expect(chatColumn).toHaveScreenshot('empty-channel.png', {
      maxDiffPixelRatio: 0.03,
      mask: [
        // Mask the composer — its placeholder includes the channel name which
        // matches a snapshot, but if anyone tweaks placeholder text we don't
        // want to fail.
        page.locator('textarea[placeholder*="Message"]'),
      ],
    });
  });

  test('message bubble with markdown + link', async ({ page }) => {
    await resetPlatform(page);
    await bootstrapAdmin(page);

    const composer = page.locator('textarea[placeholder*="Message"]');
    await typeAndSubmit(
      page,
      composer,
      '**Bold** and a [link](https://example.com) and `inline code`'
    );

    const bubble = page.locator('[data-testid="message-item"]').last();
    await expect(bubble).toBeVisible({ timeout: 10000 });

    await expect(bubble).toHaveScreenshot('message-bubble-markdown.png', {
      maxDiffPixelRatio: 0.03,
      mask: [
        // Mask timestamps and avatars (avatars use random gradient seeds).
        bubble.locator('time, .timestamp, .message-time, .avatar, .user-avatar'),
      ],
    });
  });
});
