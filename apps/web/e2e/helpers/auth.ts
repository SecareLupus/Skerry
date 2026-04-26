import { expect, type Page } from '@playwright/test';

/**
 * Performs dev-login and the onboarding "Choose Username" step.
 * Leaves the page on whatever the post-onboarding view is.
 */
export async function loginAndOnboard(
  page: Page,
  devUsername: string,
  displayUsername: string
): Promise<void> {
  await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });
  await page.locator('#dev-username').fill(devUsername);
  await page.getByRole('button', { name: 'Dev Login' }).click();

  await expect(page.getByText('Choose Username')).toBeVisible({ timeout: 15000 });
  await page.locator('#onboarding-username').fill(displayUsername);
  await page.getByRole('button', { name: 'Save Username' }).click();
}

/**
 * Full admin bootstrap flow: login + onboarding + hub initialization.
 * Assumes the platform is in a pristine (reset) state.
 */
export async function bootstrapAdmin(
  page: Page,
  options: { devUsername?: string; displayUsername?: string; hubName?: string } = {}
): Promise<void> {
  const devUsername = options.devUsername ?? 'local-admin';
  const displayUsername = options.displayUsername ?? 'admin';
  const hubName = options.hubName ?? 'Skerry E2E Test Hub';

  await loginAndOnboard(page, devUsername, displayUsername);

  await expect(page.getByText('Initialize Workspace')).toBeVisible({ timeout: 15000 });
  await page.locator('#hub-name').fill(hubName);
  await page.locator('#setup-token').fill('test_bootstrap_token');

  await Promise.all([
    page.waitForURL((url) => url.pathname === '/', { timeout: 30000 }),
    page.getByRole('button', { name: 'Bootstrap Admin + Hub' }).click(),
  ]);

  // Sidebar should be visible once bootstrap completes
  await expect(page.getByTestId('sidebar-container')).toBeVisible({ timeout: 30000 });

  // The chat client loads the default server + channel asynchronously, which
  // triggers a useEffect that pins the view to "channels". Wait for the
  // default #general channel to render so subsequent "back to servers"
  // clicks don't race that effect.
  await expect(
    page.getByTestId('channel-nav-item').filter({ hasText: /#?general/i }).first()
  ).toBeVisible({ timeout: 20000 });
}
