import { expect, type Page } from '@playwright/test';


/**
 * Navigates back to the Servers rail if the Channels view is currently active.
 * The sidebar has a useEffect that auto-flips back to "channels" view whenever
 * `selectedServerId` is truthy, so a single click can race an SSE update that
 * re-selects the last server. We retry the click up to 3 times until the
 * Servers heading is stably visible.
 */
export async function backToServers(page: Page): Promise<void> {
  await expect(page.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });

  const serversHeading = page.getByRole('heading', { name: 'Servers', level: 2 });
  const backBtn = page.getByTestId('back-to-servers');

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await serversHeading.isVisible().catch(() => false)) return;

    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
    }
    try {
      await expect(serversHeading).toBeVisible({ timeout: 5000 });
      return;
    } catch {
      // fall through and retry
    }
  }
  await expect(serversHeading).toBeVisible({ timeout: 5000 });
}

export async function selectServerByInitial(page: Page, initial: string): Promise<void> {
  await backToServers(page);
  await expect(page.getByTestId('server-nav-item')).not.toHaveCount(0, { timeout: 15000 });
  await page.getByTestId('server-nav-item').filter({ hasText: initial }).first().click();
}

export async function selectChannelByName(page: Page, name: string | RegExp): Promise<void> {
  const pattern = typeof name === 'string' ? new RegExp(`#?${name}`, 'i') : name;
  const channel = page.getByTestId('channel-nav-item').filter({ hasText: pattern }).first();
  await expect(channel).toBeVisible({ timeout: 15000 });
  await channel.click();
}

export async function openDetailsDrawer(page: Page): Promise<void> {
  const drawer = page.getByTestId('details-drawer');
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.getByTestId('toggle-member-list').click();
    await expect(drawer).toBeVisible({ timeout: 10000 });
  }
}

/** Waits for the SSE presence indicator to flip to "live". */
export async function waitForStatusLive(page: Page): Promise<void> {
  await expect(page.locator('.status-pill[data-state="live"]')).toBeVisible({ timeout: 20000 });
}

/**
 * Fills a textarea and submits via Enter, guarding against the React race
 * where `keyboard.press('Enter')` can fire before the controlled-component
 * state commit from `fill()`. The composer's Enter handler reads `value`
 * from React state, not the DOM; if the state is still stale, the submit
 * silently no-ops. Waiting for the controlled-component echo fixes this.
 */
export async function typeAndSubmit(
  page: Page,
  composer: ReturnType<Page['locator']>,
  text: string
): Promise<void> {
  await expect(composer).toBeEnabled({ timeout: 15000 });
  await composer.click();
  await composer.fill(text);
  await expect(composer).toHaveValue(text, { timeout: 5000 });
  await page.keyboard.press('Enter');
}
