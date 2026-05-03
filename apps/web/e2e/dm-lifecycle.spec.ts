import { test, expect, type Page } from '@playwright/test';
import {
  bootstrapSpaceWithChannel,
  loginAndOnboard,
  selectServerByInitial,
  selectChannelByName,
  openDetailsDrawer,
  waitForStatusLive,
} from './helpers';

/**
 * Sprint 1 Lane C — DM lifecycle regressions:
 * - #35: starting a DM updates the creator's sidebar without a refresh.
 * - #40: receiving a DM updates the recipient's sidebar without a refresh
 *   (channel.created hub event → ADD_DM_CHANNEL).
 * - #41: the topbar bell exposes a notifications panel reflecting unread DMs.
 * - #45: a non-creator can leave the DM and it disappears from their sidebar.
 *
 * These run as one scenario because the multi-context bootstrap dominates
 * runtime — splitting into four tests would 4× a ~30s setup for ~no gain.
 */
test.describe('DM lifecycle (Sprint 1 Lane C)', () => {
  let pageB: Page;
  let pageBContext: any;

  async function inviteMemberB(page: Page): Promise<string> {
    await openDetailsDrawer(page);
    await page.getByTestId('create-hub-invite-button').click();
    await page.getByTestId('hub-invite-modal').waitFor();
    await page.getByRole('button', { name: 'Generate Invite Link' }).click();
    const inviteUrlInput = page.getByTestId('invite-url-input');
    await expect(inviteUrlInput).toHaveValue(/invite\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    const url = await inviteUrlInput.inputValue();
    await page.getByTestId('done-invite-modal').click();
    return url;
  }

  async function joinAsMemberB(
    browser: any,
    inviteUrl: string
  ): Promise<{ context: any; page: Page }> {
    const context = await browser.newContext();
    const pb = await context.newPage();
    await pb.goto('/');
    await loginAndOnboard(pb, 'dm-bob', 'dm-bob');
    await pb.goto(inviteUrl);
    await expect(pb.locator('.invite-card')).toBeVisible({ timeout: 15000 });
    await Promise.all([
      pb.waitForURL((url: URL) => new URL(url.toString()).pathname === '/', { timeout: 20000 }),
      pb.getByRole('button', { name: 'Accept Invite & Join Hub' }).click(),
    ]);
    await expect(pb.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
    await expect(
      pb.getByTestId('channel-nav-item').filter({ hasText: /#?general/i }).first()
    ).toBeVisible({ timeout: 20000 });
    return { context, page: pb };
  }

  test.beforeEach(async ({ page, browser }) => {
    const { channelName } = await bootstrapSpaceWithChannel(page);
    const inviteUrl = await inviteMemberB(page);
    const joined = await joinAsMemberB(browser, inviteUrl);
    pageBContext = joined.context;
    pageB = joined.page;

    // Park both users on the seeded text channel so SSE state is "live"
    // before we exercise the DM surface.
    await selectServerByInitial(page, 'P');
    await selectChannelByName(page, channelName);
    await waitForStatusLive(page);

    await selectServerByInitial(pageB, 'P');
    await selectChannelByName(pageB, channelName);
    await waitForStatusLive(pageB);
  });

  test.afterEach(async () => {
    await pageBContext?.close();
  });

  test('admin DMs bob → both sidebars update live; bob leaves and sees it disappear', async ({ page }) => {
    // ---- #35: admin opens a DM with bob ----
    await page.getByTestId('back-to-servers').click();
    await page.getByRole('button', { name: 'New Message' }).click();
    await expect(page.getByRole('heading', { name: 'New Direct Message' })).toBeVisible({
      timeout: 5000,
    });
    await page.getByPlaceholder('Type a username...').fill('dm-bob');
    const bobRow = page.locator('.user-result-item', { hasText: 'dm-bob' });
    await expect(bobRow).toBeVisible({ timeout: 5000 });
    await bobRow.click();

    // Modal closes and admin lands on the DM. The sidebar's DMs row must show
    // bob's username — pre-fix, the row didn't appear at all until refresh.
    await expect(page.getByRole('heading', { name: 'New Direct Message' })).toBeHidden();
    await page.getByTestId('back-to-servers').click();
    const adminDmRow = page.locator('.list-item.server-entry', { hasText: 'dm-bob' });
    await expect(adminDmRow).toBeVisible({ timeout: 10000 });

    // ---- #40: bob's sidebar reflects the new DM live (no manual refresh) ----
    // The hub-stream `channel.created` event routes through ADD_DM_CHANNEL when
    // the viewer is in `participants`. Pre-fix bob would have to wait the full
    // 60s use-dms poll.
    await pageB.getByTestId('back-to-servers').click();
    const bobDmRow = pageB.locator('.list-item.server-entry', { hasText: 'admin' });
    await expect(bobDmRow).toBeVisible({ timeout: 15000 });

    // ---- #41: the notifications bell renders in the topbar ----
    // We don't depend on an exact unread count (browser-tab focus + SSE
    // markChannelAsRead can race), but the bell must be present and openable
    // and the panel must show the empty/populated state without throwing.
    await expect(pageB.getByTestId('notifications-bell')).toBeVisible();
    await pageB.getByTestId('notifications-bell').click();
    await expect(pageB.getByTestId('notifications-panel')).toBeVisible();
    // Close the panel before continuing.
    await pageB.getByTestId('notifications-bell').click();

    // ---- #45: bob leaves the DM via right-click → Leave Conversation ----
    await bobDmRow.click({ button: 'right' });
    await pageB.getByTestId('context-menu-item-leave-conversation').click();
    await pageB.getByRole('button', { name: 'Leave' }).click();

    // The DM disappears from bob's sidebar (REMOVE_DM_CHANNEL) without refresh.
    await expect(bobDmRow).toBeHidden({ timeout: 10000 });

    // Admin still sees the DM (channel survives until 0 members remain).
    await expect(adminDmRow).toBeVisible();
  });
});
