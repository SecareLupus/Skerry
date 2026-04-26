import type { Page } from '@playwright/test';

/**
 * Resets the entire platform to a pristine state and clears browser-side
 * cookies/local-storage. Call at the start of every spec's `beforeEach` so
 * feature tests give independent pass/fail signal.
 */
export async function resetPlatform(page: Page): Promise<void> {
  await page.request.post('/v1/system/test-reset');
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}
