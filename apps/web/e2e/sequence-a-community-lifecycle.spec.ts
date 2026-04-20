import { test, expect } from '@playwright/test';

/**
 * Sequence A: Community Lifecycle
 * 
 * This test uses nested steps to maintain session state (browser cookies)
 * throughout the entire lifecycle while providing granular reporting.
 */
test('Sequence A: Community Lifecycle', async ({ page, browser }) => {
  // Increase timeout for the full lifecycle sequence
  test.setTimeout(120000);

  let inviteUrl = '';
  // Shared Member B context to preserve state across steps
  let contextB: any = null;
  let pageB: any = null;

  // Helper to wait for SSE "Live" status to ensure social state is ready
  const waitForStatusLive = async (targetPage: any) => {
    await expect(targetPage.locator('.status-pill[data-state="live"]')).toBeVisible({ timeout: 20000 });
  };
  
  // -- A1: Onboarding & Core UI --
  
  await test.step('A1.1: Administrative Gateway', async () => {
    console.log('[A1.1] Initiating Administrative Gateway and Workspace Reset...');
    
    // 1. Force a clean state via the test-reset API before doing anything else
    // This ensures we start with an empty DB regardless of current UI state.
    await page.request.post('/v1/system/test-reset');
    await page.goto('/');

    // 2. Clear all local state to avoid session persistence issues
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    
    // 1. Login (Must happen first for any session)
    await expect(page.locator('.login-container')).toBeVisible({ timeout: 15000 });
    await page.locator('#dev-username').clear();
    await page.locator('#dev-username').fill('local-admin');
    await page.getByRole('button', { name: 'Dev Login' }).click();

    // 2. Identity Setup (Onboarding blocks everything else)
    await expect(page.getByText('Choose Username')).toBeVisible({ timeout: 15000 });
    await page.locator('#onboarding-username').clear();
    await page.locator('#onboarding-username').fill('admin');
    await page.getByRole('button', { name: 'Save Username' }).click();

    // 3. Workspace Initialization (Bootstrap happens for first admin after onboarding)
    await expect(page.getByText('Initialize Workspace')).toBeVisible({ timeout: 15000 });
    await page.locator('#hub-name').clear();
    await page.locator('#hub-name').fill('Skerry E2E Test Hub');
    await page.locator('#setup-token').fill('test_bootstrap_token');
    
    await Promise.all([
        page.waitForURL((url) => url.pathname === '/', { timeout: 30000 }),
        page.getByRole('button', { name: 'Bootstrap Admin + Hub' }).click()
    ]);
  });

  await test.step('A1.2: Core UI Verification', async () => {
    // Verify Shell manifested using stable ID
    await expect(page.getByTestId('sidebar-container')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.topbar-id')).toContainText('Signed in as admin');
    
    // Verify default channel accessibility using the new stable ID
    const generalChannel = page.getByTestId('channel-nav-item').filter({ hasText: '#general' });
    await expect(generalChannel).toBeVisible({ timeout: 15000 });
    await generalChannel.click();
    await expect(page.locator('.channel-header h2')).toContainText('general', { timeout: 10000 });
  });

  await test.step('A1.3: User Profile Verification', async () => {
    // Ensure we are in a text channel and the sidebar is reactive
    await expect(page.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
    // Ensure we are in a text channel and the state has settled after click
    await expect(page.locator('.timeline.panel')).toBeVisible({ timeout: 15000 });
    
    const composer = page.locator('textarea[placeholder*="Message"]');
    await expect(composer).toBeEnabled({ timeout: 15000 });
    
    // Robust typing with retry logic to handle background clearing
    let typedSuccessfully = false;
    for (let i = 0; i < 3; i++) {
        await composer.fill('Profile verification sequence initiated.');
        await page.waitForTimeout(500);
        const val = await composer.inputValue();
        if (val === 'Profile verification sequence initiated.') {
            typedSuccessfully = true;
            break;
        }
        console.warn(`[A1.3] Composer cleared by background update, retrying... (${i+1}/3)`);
        await page.waitForTimeout(1000);
    }
    
    if (!typedSuccessfully) {
        throw new Error('Failed to stabilize composer input after 3 attempts');
    }
    
    // Explicitly wait for the Send button to be enabled
    const sendBtn = page.getByRole('button', { name: 'Send' });
    await expect(sendBtn).toBeEnabled({ timeout: 15000 });
    
    // Send via Enter key for extra stability
    await composer.press('Enter');
    
    // Wait for the message to appear in the timeline (A1.3.1)
    const messageItem = page.locator('[data-testid="message-item"]').first();
    await expect(messageItem).toBeVisible({ timeout: 15000 });
    
    // Click our own author name
    const authorName = messageItem.locator('.author-name');
    await authorName.click();
    
    // Verify & Edit Profile Modal
    const modal = page.locator('.modal-card');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.username')).toContainText('@admin');
    
    await modal.getByRole('button', { name: 'Edit Profile' }).click();
    await modal.locator('input[placeholder="How should people see you?"]').clear();
    await modal.locator('input[placeholder="How should people see you?"]').fill('Skerry Admin');
    await modal.locator('textarea[placeholder="Tell us about yourself"]').clear();
    await modal.locator('textarea[placeholder="Tell us about yourself"]').fill('Automated Test bio for Sequence A.');
    await modal.getByRole('button', { name: 'Save Changes' }).click();
    
    // Verify persistence
    await expect(modal.locator('h1')).toContainText('Skerry Admin');
    await expect(modal.locator('.bio-text')).toContainText('Automated Test bio for Sequence A.');
    
    await modal.locator('.close-button').click();
    await expect(modal).not.toBeVisible();
  });

  // -- A2: Community Orchestration --

  await test.step('A2.1: Creator Server Creation', async () => {
    // If we are in the Channels view, navigate back to the Servers rail
    // The button has title="Back to Servers" but often shows up as "←" in some accessibility trees
    const backButton = page.locator('.back-button');
    if (await backButton.isVisible()) {
        await backButton.click();
    }
    
    // Explicitly wait for the Servers rail to be the active view
    await expect(page.getByRole('heading', { name: 'Servers', level: 2 })).toBeVisible({ timeout: 15000 });
    
    const createSpaceBtn = page.getByRole('button', { name: 'Create Space' });
    await expect(createSpaceBtn).toBeVisible({ timeout: 15000 });
    await createSpaceBtn.click();
    
    const modal = page.locator('.modal-backdrop:has(.modal-panel)');
    await expect(modal).toBeVisible();
    await modal.locator('#space-name-modal').clear();
    await modal.locator('#space-name-modal').fill('Playwright Server');
    await modal.getByRole('button', { name: 'Create Space' }).click();
    
    await expect(page.locator('.server-title')).toContainText('Playwright Server', { timeout: 15000 });
  });

  await test.step('A2.2: Category Orchestration', async () => {
    const addBtn = page.locator('nav.channels button[title="Add..."]');
    await addBtn.click();
    
    // Ensure dropdown is visible
    await page.locator('.add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Category' }).click();
    
    await page.locator('#category-name-modal').clear();
    await page.locator('#category-name-modal').fill('Test Category');
    await page.getByRole('button', { name: 'Create Category' }).click();
    
    await expect(page.locator('.category-heading', { hasText: 'Test Category' })).toBeVisible({ timeout: 15000 });
  });

  await test.step('A2.3: Text Channel Orchestration', async () => {
    const addBtn = page.locator('nav.channels button[title="Add..."]');
    await addBtn.click();
    
    await page.locator('.add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Room' }).click();
    
    await page.locator('#room-name-modal').clear();
    await page.locator('#room-name-modal').fill('Text Lab');
    await page.getByRole('button', { name: 'Create Room' }).click();
    
    await expect(page.locator('.modal-backdrop')).not.toBeVisible({ timeout: 15000 });
    
    const roomBtn = page.locator('.list-item', { hasText: /#Text Lab/i });
    await expect(roomBtn).toBeVisible({ timeout: 15000 });
    await roomBtn.click();
    
    const chatHeader = page.locator('.channel-header h2');
    await expect(chatHeader).toContainText(/Text Lab/i, { timeout: 15000 });
  });

  await test.step('A2.4: Voice Channel Orchestration', async () => {
    const addBtn = page.getByTestId('add-channel-menu-trigger');
    await addBtn.click();
    
    await page.getByTestId('add-menu-dropdown').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'New Room' }).click();
    
    await page.locator('#room-name-modal').clear();
    await page.locator('#room-name-modal').fill('Voice Lab');
    await page.locator('#room-type-modal').selectOption('voice');
    await page.getByRole('button', { name: 'Create Room' }).click();
    
    await expect(page.getByTestId('modal-backdrop')).not.toBeVisible();
    
    const roomBtn = page.getByTestId('channel-nav-item').filter({ hasText: /Voice Lab/i });
    await expect(roomBtn).toBeVisible({ timeout: 15000 });
    await roomBtn.click();
    await expect(page.locator('.channel-header h2')).toContainText(/Voice Lab/i, { timeout: 15000 });
    
    // Debug: Ensure React state is synced
    const debugMarker = page.getByTestId('debug-voice-state');
    await expect(debugMarker).toHaveAttribute('data-type', 'voice', { timeout: 10000 });
    await expect(debugMarker).toHaveAttribute('data-voice-connected', 'false', { timeout: 10000 });

    const joinBtn = page.getByTestId('join-voice-btn');
    await expect(joinBtn).toBeVisible({ timeout: 10000 });
    await joinBtn.click();
    
    const detailsSidebar = page.locator('aside', { hasText: /Channel Details/i });
    
    // Explicit wait for Reactive state transition using the debug marker
    await expect(debugMarker).toHaveAttribute('data-voice-connected', 'true', { timeout: 15000 });
    
    // Verify Sidebar state
    await expect(detailsSidebar.getByText(/Status: Connected/i)).toBeVisible({ timeout: 10000 });
    
    // RTC connection verification
    await expect(page.locator('.voice-room')).toBeVisible({ timeout: 20000 });
    
    // Verify admin identity in the room
    const adminCard = page.locator('.voice-room .participant-card', { hasText: /admin/i });
    await expect(adminCard).toBeVisible({ timeout: 20000 });
    
    const leaveBtn = page.getByRole('button', { name: 'Leave Voice' });
    await expect(leaveBtn).toBeVisible();
    await leaveBtn.click();
    
    await expect(page.locator('.voice-room')).not.toBeVisible();
    await expect(detailsSidebar.getByText(/Status: Disconnected/i)).toBeVisible();
  });

  // -- A3: The Orientation Bridge --

  await test.step('A3.1: Invite Generation', async () => {
    // Active server can drift back to the home-hub default after voice leave in A2.4.
    // Navigate to Playwright Server explicitly — same pattern A4.1 uses.
    if ((await page.locator('.server-title').textContent()) !== 'Playwright Server') {
        const adminBack = page.getByTestId('back-to-servers');
        if (await adminBack.isVisible()) await adminBack.click();
        await expect(page.getByTestId('server-nav-item')).not.toHaveCount(0, { timeout: 15000 });
        await page.getByTestId('server-nav-item').filter({ hasText: 'P' }).click();
    }
    await expect(page.locator('.server-title')).toHaveText('Playwright Server', { timeout: 10000 });

    const detailsBtn = page.locator('button[data-testid="toggle-member-list"]');
    const detailsPanel = page.getByTestId('details-drawer');

    if (!await detailsPanel.isVisible()) {
        await detailsBtn.click();
        await expect(detailsPanel).toBeVisible({ timeout: 10000 });
    }

    const inviteBtn = page.getByTestId('create-hub-invite-button');
    await expect(inviteBtn).toBeVisible({ timeout: 15000 });
    await inviteBtn.click();

    const inviteModal = page.getByTestId('hub-invite-modal');
    await expect(inviteModal).toBeVisible({ timeout: 10000 });
    // Confirms the modal is scoped to Playwright Server, not the home hub
    await expect(inviteModal.getByRole('heading', { name: /Invite to Playwright Server/i })).toBeVisible();

    await inviteModal.getByRole('button', { name: 'Generate Invite Link' }).click();

    const inviteUrlInput = page.getByTestId('invite-url-input');
    await expect(inviteUrlInput).toHaveValue(/invite\/[a-zA-Z0-9_-]+/, { timeout: 10000 });
    inviteUrl = await inviteUrlInput.inputValue();

    await page.getByTestId('copy-invite-url').click();
    await expect(page.locator('.toast-success').filter({ hasText: 'Link copied!' }).last()).toBeVisible({ timeout: 5000 });

    await page.getByTestId('done-invite-modal').click();
    await expect(inviteModal).not.toBeVisible({ timeout: 8000 });
  });

  await test.step('A3.2: Invitation Usage', async () => {
    // 1. Setup Member B context (Create fresh if not already exists)
    if (!contextB) {
        contextB = await browser.newContext();
        pageB = await contextB.newPage();
    }
    
    try {
        await pageB.goto('/');
        
        // 1. Login as Member B
        await expect(pageB.locator('.login-container')).toBeVisible({ timeout: 15000 });
        await pageB.locator('#dev-username').clear();
        await pageB.locator('#dev-username').fill('local-member');
        await pageB.getByRole('button', { name: 'Dev Login' }).click();

        // 2. Identity Setup for Member B
        await expect(pageB.getByText('Choose Username')).toBeVisible({ timeout: 15000 });
        await pageB.locator('#onboarding-username').clear();
        await pageB.locator('#onboarding-username').fill('member_b');
        await pageB.getByRole('button', { name: 'Save Username' }).click();

        // 3. Navigate to Invitation and Join
        console.log(`[A3.2] Navigating Member B to: ${inviteUrl}`);
        await pageB.goto(inviteUrl);
        await expect(pageB.locator('.invite-card')).toBeVisible({ timeout: 15000 });
        
        // Accept and wait for redirect to Home
        console.log('[A3.2] Clicking Accept Invite...');
        await Promise.all([
            pageB.waitForURL((url: URL) => new URL(url.toString()).pathname === '/', { timeout: 20000 }),
            pageB.getByRole('button', { name: 'Accept Invite & Join Hub' }).click()
        ]);

        console.log('[A3.2] Redirected to:', pageB.url());
        if (pageB.url().includes('/login')) {
            throw new Error('[A3.2] Redirected to /login unexpectedly. Session lost?');
        }

        // 4. Verify landing (Home Hub)
        console.log('[A3.2] Waiting for sidebar container...');
        await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
        
        // Home Hub should have #general
        console.log('[A3.2] Verifying #general in Home Hub...');
        await expect(pageB.getByTestId('channel-nav-item').filter({ hasText: /#?general/i })).toBeVisible({ timeout: 20000 });

        // 5. Switch to Playwright Server and verify #Text Lab
        console.log('[A3.2] Navigating to Playwright Server...');
        
        // Ensure we are in the Servers view so we can see the server-nav-items
        const backBtn = pageB.getByTestId('back-to-servers');
        if (await backBtn.isVisible()) {
            await backBtn.click();
        }
        
        // Now we should see the server icons
        console.log('[A3.2] Waiting for server list synchronization...');
        await expect(pageB.getByTestId('server-nav-item')).toHaveCount(2, { timeout: 25000 });

        const serverTitle = pageB.locator('.server-title');
        let playwrightIcon = pageB.getByTestId('server-nav-item').filter({ hasText: 'P' });
        
        if (!(await playwrightIcon.isVisible())) {
            console.log('[A3.2] Playwright Server icon not found. Reloading...');
            await pageB.reload();
            await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
            
            // Re-nav back to servers after reload if necessary
            if (await backBtn.isVisible()) {
                await backBtn.click();
            }
            playwrightIcon = pageB.getByTestId('server-nav-item').filter({ hasText: 'P' });
        }
        
        await playwrightIcon.click({ force: true });
        
        // Verify Playwright Server title
        await expect(serverTitle).toHaveText('Playwright Server', { timeout: 15000 });
        
        // Verify #Text Lab channel is visible
        console.log('[A3.2] Verifying #Text Lab in Playwright Server...');
        await expect(pageB.getByTestId('channel-nav-item').filter({ hasText: /#?Text Lab/i })).toBeVisible({ timeout: 15000 });
        
    } catch (err) {
        console.error('A3.2 FAILURE FORENSICS (Member B):');
        const url = pageB.url();
        const content = await pageB.content();
        console.error(`URL: ${url}`);
        console.error(`CONTENT: ${content.slice(0, 3000)}`);
        throw err;
    }
  });


  // -- A4: Advanced Messaging & Social --

  await test.step('A4.1: Real-time Multi-user Chat', async () => {
    // 1. Ensure Admin is on Playwright Server / #Text Lab
    console.log('[A4.1] Navigating Admin to #Text Lab...');
    
    // Close any stray modals first
    const strayModalClose = page.getByRole('button', { name: '×' }).first();
    if (await strayModalClose.isVisible()) {
        await strayModalClose.click();
    }

    // Ensure we are in the Servers view so we can see the server-nav-items
    const adminBack = page.getByTestId('back-to-servers');
    if (await adminBack.isVisible()) await adminBack.click();
    
    // Explicitly wait for server icons to be visible
    await expect(page.getByTestId('server-nav-item')).not.toHaveCount(0, { timeout: 15000 });
    await page.getByTestId('server-nav-item').filter({ hasText: 'P' }).click();
    await page.getByTestId('channel-nav-item').filter({ hasText: /#?Text Lab/i }).click();
    await expect(page.locator('.channel-header')).toContainText('Text Lab');
    await waitForStatusLive(page); // Ensure Admin is live on the new channel
    
    // Open the member list if not already open so we can verify the member count
    const memberToggle = page.getByTestId('toggle-member-list');
    const detailsPanelA = page.getByTestId('details-drawer');
    if (!await detailsPanelA.isVisible()) {
        await memberToggle.click();
        await expect(detailsPanelA).toBeVisible({ timeout: 5000 });
    }
    
    // Wait for the member list to ensure the channel state is fully initialized
    await expect(page.getByTestId('member-item')).not.toHaveCount(0, { timeout: 10000 });

    // 2. Ensure Member B is ready (Re-use existing context from A3.2)
    if (!contextB || !pageB) {
        contextB = await browser.newContext();
        pageB = await contextB.newPage();
        await pageB.goto('/');
        await pageB.locator('#dev-username').fill('local-member');
        await pageB.getByRole('button', { name: 'Dev Login' }).click();
        await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
    }
    
    // 3. Navigate Member B to Playwright Server / #Text Lab
    console.log('[A4.1] Navigating Member B to #Text Lab...');
    
    // We expect Member B to already be on some page. 
    // Ensure we are in a clean state for the server switch.
    const backBtn = pageB.getByTestId('back-to-servers');
    if (await backBtn.isVisible()) await backBtn.click();
    
    // Select Playwright Server
    await expect(pageB.getByTestId('server-nav-item')).not.toHaveCount(0, { timeout: 15000 });
    await pageB.getByTestId('server-nav-item').filter({ hasText: 'P' }).click();
    
    const channelBtn = pageB.getByTestId('channel-nav-item').filter({ hasText: /#?Text Lab/i });
    await expect(channelBtn).toBeVisible({ timeout: 15000 });
    await channelBtn.click();
    
    // Wait for channel header to confirm active channel state sync
    console.log('[A4.1] Waiting for Member B channel header synchronization...');
    const channelHeaderB = pageB.locator('.channel-header');
    await expect(channelHeaderB).toContainText('Text Lab', { timeout: 15000 });
    await waitForStatusLive(pageB); // Ensure Member B is live too
    
    // 4. Member B replies
    const composerB = pageB.locator('textarea[placeholder*="Message"]');
    await expect(composerB).toBeVisible({ timeout: 15000 });
    
    // Brief wait for state stability before interaction
    await pageB.waitForTimeout(1000);
    await composerB.click();
    
    const msgContent = `Hello from Member B! ${Date.now()}`;
    await composerB.fill(msgContent);
    await expect(composerB).toHaveValue(msgContent);
    
    // Use Enter for stable submission
    await pageB.keyboard.press('Enter');
    
    // 5. Verify synchronization
    console.log('[A4.1] Verifying message delivery...');
    // Member B sees their own message — tolerate the optimistic + confirmed duplicate
    // that briefly coexists (.first() picks whichever renders first)
    try {
        await expect(pageB.locator(`text="${msgContent}"`).first()).toBeVisible({ timeout: 15000 });
    } catch (err) {
        console.error('A4.1 FAILURE FORENSICS (Member B):');
        console.error(`URL: ${pageB.url()}`);
        console.error(`CONTENT: ${(await pageB.content()).slice(0, 3000)}`);
        throw err;
    }

    // Admin sees the message arrive in real-time (only one copy since Admin didn't send it)
    await expect(page.locator(`text="${msgContent}"`).first()).toBeVisible({ timeout: 15000 });
  });

  await test.step('A4.2: Markdown & Rich Text', async () => {
    console.log('[A4.2] Verifying Markdown rendering...');
    if (await page.locator('.server-title').textContent() !== 'Playwright Server') {
        const adminBack = page.getByTestId('back-to-servers');
        if (await adminBack.isVisible()) await adminBack.click();
        await page.getByTestId('server-nav-item').filter({ hasText: 'P' }).click();
    }
    await expect(page.locator('.channel-header')).toContainText('Text Lab');
    await expect(page.getByTestId('member-item')).not.toHaveCount(0, { timeout: 10000 });
    
    // Brief stability wait before typing
    await page.waitForTimeout(500);
    
    const composer = page.locator('textarea[placeholder*="Message"]');
    const ts = Date.now();
    const markdownMsg = `**Bold Text** ${ts} and [Skerry Link](https://skerry.io)`;
    
    // Use fill to reliably enter markdown without triggering input formatting glitches
    await composer.fill(markdownMsg);
    await expect(composer).toHaveValue(markdownMsg);
    await composer.press('Enter');
    
    // Wait for the message to appear in the DOM using the unique timestamp
    const lastMsg = page.locator(`[data-testid="message-item"]:has-text("${ts}")`).first();
    await expect(lastMsg).toBeVisible({ timeout: 15000 });
    
    // Use precise locator to avoid strict mode violation with author-name
    await expect(lastMsg.locator('.message-content-wrapper strong')).toContainText('Bold Text');
    await expect(lastMsg.locator('a')).toHaveAttribute('href', 'https://skerry.io');
  });

  await test.step('A4.3: Message Lifecycle (Edit/Delete)', async () => {
    console.log('[A4.3] Verifying Message Lifecycle (Edit/Delete)...');
    const originalContent = `Lifecycle test ${Date.now()}`;
    const composer = page.locator('textarea[placeholder*="Message"]');
    
    // Ensure UI is interactive
    await expect(page.locator('.channel-header')).toContainText('Text Lab');
    await expect(page.getByTestId('member-item')).not.toHaveCount(0, { timeout: 10000 });
    await page.waitForTimeout(500);

    await composer.fill(originalContent);
    await composer.press('Enter');
    
    const message = page.locator(`[data-testid="message-item"]:has-text("${originalContent}")`).first();
    await expect(message).toBeVisible();
    
    // Edit
    await message.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.getByRole('button', { name: 'Edit Message' }).click();
    
    const editArea = page.locator('.edit-textarea');
    await expect(editArea).toBeVisible({ timeout: 10000 });
    const editedContent = `Edited Lifecycle ${Date.now()}`;
    await editArea.fill(editedContent);
    await editArea.press('Enter');
    
    await expect(page.locator(`text="${editedContent}"`)).toBeVisible();
    await expect(page.locator(`text="${originalContent}"`)).not.toBeVisible();
    
    // Delete
    await page.locator(`[data-testid="message-item"]:has-text("${editedContent}")`).click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.getByRole('button', { name: 'Delete Message' }).click();
    
    // Handle Custom Confirmation Modal
    const modal = page.locator('.modal-card');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Delete' }).click();
    
    await expect(page.locator(`[data-testid="message-item"]:has-text("${editedContent}")`)).not.toBeVisible({ timeout: 10000 });
  });

  await test.step('A4.4: Social Interactions', async () => {
    // Reaction
    const composer = page.locator('textarea[placeholder*="Message"]');
    const reactMsg = `React to me ${Date.now()}`;
    await composer.click();
    await composer.pressSequentially(reactMsg, { delay: 10 });
    await page.keyboard.press('Enter');
    
    const message = page.locator('[data-testid="message-item"]').filter({ hasText: reactMsg }).first();
    // Wait for message to be server-confirmed (not 'Sending...')
    await expect(message).toBeVisible({ timeout: 10000 });
    await expect(message).not.toContainText('Sending...', { timeout: 10000 });
    
    await message.hover();
    await message.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Add Reaction' }).click();
    
    // Pick an emoji - Use one guaranteed to be in the first category
    await expect(page.locator('.emoji-picker-container')).toBeVisible({ timeout: 10000 });
    
    // Wait for internal content to load (at least one emoji button)
    await expect(page.locator('.emoji-picker-container .epr-emoji-list button').first()).toBeVisible({ timeout: 10000 });

    // Use a very inclusive selector for a common emoji (smiling face / grinning face / 😀)
    const emoji = page.locator('.emoji-picker-container button')
      .filter({ has: page.locator('img[alt*="smile"], img[alt*="grinn"], img[alt*="face"]') })
      .or(page.locator('.emoji-picker-container button[aria-label*="smil"], .emoji-picker-container button[aria-label*="grinn"]'))
      .first();
      
    await expect(emoji).toBeEnabled({ timeout: 5000 });
    await emoji.click();
    
    await expect(message.locator('[data-testid="reaction-badge"]')).toBeVisible({ timeout: 5000 });
    
    // Threading
    console.log('[A4.4] Testing Threading...');
    await waitForStatusLive(page); // Extra safety for threading
    await message.click({ button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.getByRole('button', { name: /Reply in Thread/i }).click();
    
    const threadPanel = page.locator('.thread-panel');
    await expect(threadPanel).toBeVisible({ timeout: 15000 });
    
    const threadComposer = threadPanel.locator('textarea');
    const threadReplyContent = `Threaded reply ${Date.now()}`;
    await threadComposer.click();
    await threadComposer.pressSequentially(threadReplyContent, { delay: 30 });
    await threadComposer.press('Enter');
    
    await expect(threadPanel.locator('p').filter({ hasText: threadReplyContent }).first()).toBeVisible({ timeout: 15000 });
    
    // Verify reply count in main chat
    console.log('[A4.4] Verifying main chat reply count...');
    await expect(message.locator('.thread-trigger-btn')).toContainText(/repl(y|ies)/i, { timeout: 10000 });
  });

  // -- A5: Permissions & Moderation --

  await test.step('A5.1: Permission Gates', async () => {
    console.log('[A5.1] Verifying Permission Gates for Member B...');
    // Ensure Member B is logged in and in the space
    await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 30000 });

    // 1. Verify restricted UI elements are hidden
    await expect(pageB.getByTestId('add-space-button')).not.toBeVisible();
    await expect(pageB.getByTestId('server-settings-button')).not.toBeVisible();

    // 2. Attempt indirect access through URL (Space Settings)
    const currentUrl = page.url(); // Admin page URL
    const spaceId = currentUrl.split('/spaces/')[1]?.split('/')[0];
    if (spaceId) {
      await pageB.goto(`/settings/spaces/${spaceId}`);
      // Member should be gated or see only "User Settings" without the Space menu
      await expect(pageB.locator('h1')).not.toContainText('Space Settings', { timeout: 10000 });
      // Restore page state for following steps
      await pageB.goto('/');
      await expect(pageB.getByTestId('sidebar-container')).toBeVisible({ timeout: 15000 });
    }
  });

  await test.step('A5.2: Scoped Moderation (Kick)', async () => {
    console.log('[A5.2] Executing Scoped Kick Action...');
    await page.bringToFront();
    await waitForStatusLive(page); // Ensure Admin is live before moderation
    
    // Ensure Details drawer is open
    const detailsDrawer = page.getByTestId('details-drawer');
    if (!await detailsDrawer.isVisible()) {
      await page.getByTestId('toggle-member-list').click();
      await expect(detailsDrawer).toBeVisible({ timeout: 15000 });
    }
    
    // Wait for member list to stabilize
    await expect(page.getByTestId('member-item')).not.toHaveCount(0, { timeout: 10000 });
    
    // Locate member_b
    const memberItem = page.getByTestId('member-item').filter({ hasText: /member_b/i }).first();
    await expect(memberItem).toBeVisible({ timeout: 15000 });
    
    await memberItem.click({ button: 'right', force: true });
    
    const contextMenu = page.locator('.context-menu');
    await expect(contextMenu).toBeVisible({ timeout: 10000 });
    
    const moderateBtn = page.getByRole('button', { name: /Moderate User/i });
    await expect(moderateBtn).toBeVisible({ timeout: 10000 });
    await moderateBtn.click();
    
    await expect(page.getByTestId('moderation-modal')).toBeVisible({ timeout: 15000 });
    
    await page.getByTestId('moderation-action-select').selectOption('kick');
    
    // Explicitly select the 'Space' scope for the kick action to ensure serverId is used
    await page.locator('input[type="radio"][value="server"]').click();
    
    const kickReason = 'E2E Test: Behavior violation';
    const reasonInput = page.getByTestId('moderation-reason-input');
    await reasonInput.click();
    await reasonInput.pressSequentially(kickReason, { delay: 50 });
    
    await page.getByTestId('confirm-moderation-button').click();
    
    // Verify disappearance from Admin view — the authoritative signal.
    // Member B remains a hub member (kick is scoped to the space), so no redirect
    // happens on their side. A5.3 confirms the kick was persisted via the audit log.
    await expect(memberItem).not.toBeVisible({ timeout: 15000 });
  });

  await test.step('A5.3: Audit Log Verification', async () => {
    console.log('[A5.3] Verifying Audit Log persistence...');
    await page.bringToFront();

    // Admin URL while viewing a channel is /?server=srv_xxx&channel=chn_xxx.
    // Extract the server id from the query string — that's the "space" id in the
    // audit log route.
    const currentUrl = new URL(page.url());
    const spaceId = currentUrl.searchParams.get('server');
    if (!spaceId) throw new Error(`A5.3: could not derive server id from URL: ${page.url()}`);

    await page.goto(`/settings/spaces/${spaceId}/audit-log`);
    // Layout wraps pages in its own <h1>Settings</h1>; match the page's own heading.
    await expect(page.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeVisible({ timeout: 15000 });

    // Verify the "kick" action is recorded.
    // The target column renders as "usr_xxxx..." (truncated id), not the username,
    // so we can't match on "member_b". Instead, confirm a kick row exists.
    const auditEntry = page.locator('.audit-entry').filter({ hasText: /kick/i }).first();
    await expect(auditEntry).toBeVisible({ timeout: 15000 });
  });

  // Final cleanup for Member B
  if (contextB) {
    await contextB.close();
  }
});
