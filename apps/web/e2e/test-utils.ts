import { type Page, expect } from '@playwright/test';

/**
 * Resets the entire workspace to a clean state for testing.
 * Only works in development environments.
 */
export async function resetTestEnvironment(page: Page) {
  // Call the control plane directly via the proxy
  const response = await page.request.post('/v1/system/test-reset');
  if (!response.ok()) {
    const text = await response.text();
    console.error(`Failed to reset test environment: ${text}`);
    throw new Error(`Workspace reset failed: ${response.status()}`);
  }
}

/**
 * Standard login and setup flow for E2E tests.
 */
export async function setupAndLogin(page: Page, username: string = 'local-admin') {
  // Forward console messages with type info
  page.on('console', msg => {
    const text = msg.text();
    const type = msg.type();
    if (type === 'error') {
      console.error(`[BROWSER ERROR] ${text}`);
    } else if (type === 'warning') {
      console.warn(`[BROWSER WARN] ${text}`);
    } else {
      console.log(`[BROWSER LOG] ${text}`);
    }
  });

  await page.goto('/');
  
  // 0. Ensure clean state (now that we have an origin)
  console.log('[setupAndLogin] Clearing cookies and localStorage...');
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // 1. Initial Login
  console.log('[setupAndLogin] Waiting for dev login form...');
  await page.waitForSelector('input[id="dev-username"]', { timeout: 15000 });
  await page.fill('input[id="dev-username"]', username);
  
  console.log('[setupAndLogin] Clicking Dev Login...');
  await page.click('button:has-text("Dev Login")');

  // Wait for navigation or state change
  console.log('[setupAndLogin] Waiting for transition from login page...');
  await page.waitForFunction(() => !document.querySelector('input[id="dev-username"]'), { timeout: 10000 });
  console.log(`[setupAndLogin] Transitioned. Current URL: ${page.url()}`);

  // 2. Wait for loading to finish (if it's there)
  console.log('[setupAndLogin] Waiting for loading screen (if any)...');
  try {
      await page.waitForSelector('text="Loading local workspace..."', { state: 'visible', timeout: 3000 });
      console.log('[setupAndLogin] Loading screen visible, waiting for detachment...');
      await page.waitForSelector('text="Loading local workspace..."', { state: 'detached', timeout: 15000 });
  } catch (err) {
      console.log('[setupAndLogin] Loading screen not detected or already detached.');
  }

  // 3. Handle Onboarding if needed
  const onboardingInput = page.locator('input[id="onboarding-username"]');
  if (await onboardingInput.isVisible()) {
    console.log('[setupAndLogin] Detected onboarding screen, completing...');
    await onboardingInput.fill(username);
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/auth/onboarding/username') && res.status() === 204),
      page.click('button:has-text("Save Username")')
    ]);
    console.log('[setupAndLogin] Onboarding submitted, waiting for reload...');
    await page.waitForSelector('text="Loading local workspace..."', { state: 'detached', timeout: 10000 });
  }

  // 4. Handle Bootstrap if needed
  const hubNameInput = page.locator('input[id="hub-name"]');
  if (await hubNameInput.isVisible()) {
    console.log('[setupAndLogin] Detected bootstrap screen, completing...');
    await hubNameInput.fill('Test Hub');
    await page.fill('input[id="setup-token"]', 'test_bootstrap_token');
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/auth/bootstrap-admin') && res.status() === 201),
      page.click('button:has-text("Bootstrap Admin + Hub")')
    ]);
    console.log('[setupAndLogin] Bootstrap submitted, waiting for reload...');
    await page.waitForSelector('text="Loading local workspace..."', { state: 'detached', timeout: 10000 });
  }

  // 5. Final stability check
  console.log('[setupAndLogin] Finalizing login...');
  await waitForAppStability(page);
  console.log('[setupAndLogin] Login flow complete.');
}

/**
 * Wait for the user to have specific roles or permissions.
 */
export async function waitForPermissions(page: Page, options: { roles?: string[], actions?: string[] } = {}) {
  console.log(`[permissions] Waiting for roles: ${options.roles?.join(',')} actions: ${options.actions?.join(',')}`);
  
  await page.waitForFunction((opts) => {
    const state = (window as any).state;
    if (!state) return false;
    
    if (opts.roles && opts.roles.length > 0) {
      const hasAllRoles = opts.roles.every(role => 
        state.viewerRoles?.some((r: any) => r.role === role)
      );
      if (!hasAllRoles) return false;
    }
    
    if (opts.actions && opts.actions.length > 0) {
      const hasAllActions = opts.actions.every(action => state.allowedActions?.includes(action));
      if (!hasAllActions) return false;
    }
    
    return true;
  }, options, { timeout: 30000 });
  
  console.log('[permissions] Required permissions detected.');
}

/**
 * Waits for the app to be in a stable "Live" or "Polling" state, 
 * or "Disconnected" if it's a fresh workspace with no servers.
 */
export async function waitForAppStability(page: Page) {
  console.log('[stability] Waiting for sidebar or onboarding...');
  
  // Wait for either the sidebar OR a known major loading/onboarding component
  await page.waitForFunction(() => {
    return document.querySelector('.unified-sidebar') || 
           document.querySelector('input#onboarding-username') ||
           document.querySelector('input#hub-name');
  }, { timeout: 30000 });
  
  // 1. Wait for ChatContext to be initialized and loading to stop
  console.log('[stability] Waiting for ChatContext loading to finish...');
  await page.waitForFunction(() => {
    const state = (window as any).state;
    return state && state.loading === false;
  }, { timeout: 30000 });

  // 2. Wait for status pill state reconciliation
  console.log('[stability] ChatContext initialized. Checking status pill...');
  
  await page.waitForFunction(() => {
    const state = (window as any).state;
    if (!state) return false;

    // If we have no servers, the app stays "disconnected" by design
    if (state.servers?.length === 0) {
      console.log('[stability] No servers detected, allowing disconnected state.');
      return true;
    }

    const pill = document.querySelector('[data-testid="status-pill"]');
    if (!pill) return false;
    
    const pillState = pill.getAttribute('data-state');
    return pillState === 'live' || pillState === 'polling';
  }, { timeout: 30000 });

  console.log('[stability] App reached a stable state.');
}

/**
 * Wait for the Hubs list to be populated in the global state.
 */
export async function waitForHubs(page: Page, count: number = 1) {
    console.log(`[stability] Waiting for at least ${count} hub(s) in state...`);
    await page.waitForFunction((expectedCount) => {
        const state = (window as any).state;
        return state && state.hubs && state.hubs.length >= expectedCount;
    }, count, { timeout: 30000 });
}

/**
 * Wait for the Servers list to be populated in the global state.
 */
export async function waitForServers(page: Page, count: number = 1) {
    console.log(`[stability] Waiting for at least ${count} server(s) in state...`);
    await page.waitForFunction((expectedCount) => {
        const state = (window as any).state;
        return state && state.servers && state.servers.length >= expectedCount;
    }, count, { timeout: 30000 });
}

/**
 * Helper to create a new space and room for test isolation if needed.
 */
export async function createSpaceAndRoom(
    page: Page, 
    serverName: string, 
    roomName: string,
    roomType: 'text' | 'forum' | 'voice' | 'announcement' | 'landing' = 'text'
) {
    console.log(`[createSpaceAndRoom] Target: Space="${serverName}", Room="${roomName}"`);
    console.log('[createSpaceAndRoom] Current Browser URL:', page.url());
    
    // Ensure UI has painted before trying to click buttons
    await page.waitForSelector('.unified-sidebar', { timeout: 15000 });

    // Go back to server list to make sure we are at the root
    console.log('[createSpaceAndRoom] Clicking Back to Servers...');
    const backBtn = page.locator('button[title="Back to Servers"]');
    if (await backBtn.isVisible()) {
        await backBtn.click();
        console.log('[createSpaceAndRoom] Sent click to Back to Servers.');
        // Wait for Server list to appear
        await page.waitForSelector('h2:has-text("Servers")', { timeout: 5000 }).catch(() => {
            console.warn('[createSpaceAndRoom] Server list heading not found after clicking back.');
        });
    }
    
    // Open Create Space modal
    console.log('[createSpaceAndRoom] Waiting for hub_admin permissions reach...');
    await waitForPermissions(page, { roles: ['hub_admin'] });

    console.log('[createSpaceAndRoom] Opening Create Space modal...');
    const createBtn = page.locator('button[aria-label="Create Space"]');
    await createBtn.waitFor({ state: 'visible', timeout: 10000 });
    
    await createBtn.click();
    console.log('[createSpaceAndRoom] Clicked Create Space. Waiting for modal form...');
    await page.waitForSelector('input#space-name-modal', { timeout: 5000 });
    
    // Fill form
    await page.fill('input#space-name-modal', serverName);
    
    // Submit
    console.log(`[createSpaceAndRoom] Submitting form. Modal Value: ${await page.inputValue('input#space-name-modal')}`);
    const submitBtn = page.locator('button[type="submit"]:has-text("Create Space")');
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });

    const hubsState = await page.evaluate(() => (window as any).state?.hubs);
    console.log(`[createSpaceAndRoom] Current hubs in state: ${JSON.stringify(hubsState)}`);

    if (hubsState && hubsState.length > 1) {
       console.log(`[createSpaceAndRoom] Multiple hubs detected, selecting the first one.`);
       await page.selectOption('select#hub-selection', hubsState[0].id);
    }

    // Submit with 429 retry
    let retryCount = 0;
    const maxRetries = 2;
    while (retryCount <= maxRetries) {
        console.log(`[createSpaceAndRoom] Submitting form (Attempt ${retryCount + 1})...`);
        await submitBtn.click();
        
        // Wait to see if it closes or fails
        const result = await Promise.race([
            page.locator('.modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).then(() => 'success'),
            page.locator('text="Rate limit exceeded"').waitFor({ state: 'visible', timeout: 5000 }).then(() => 'rate-limited'),
            page.waitForTimeout(5000).then(() => 'timeout')
        ]);

        if (result === 'success') {
            console.log('[createSpaceAndRoom] Modal closed successfully.');
            break;
        } else if (result === 'rate-limited') {
            console.warn('[createSpaceAndRoom] Hit rate limit, waiting 10s before retry...');
            await page.waitForTimeout(10000);
            retryCount++;
        } else {
            console.error(`[createSpaceAndRoom] Modal FAILED to close (Result: ${result})!`);
            if (retryCount === maxRetries) {
                await page.screenshot({ path: `playwright-report/modal-stuck-${Date.now()}.png` });
                throw new Error('Modal stuck after maximum retries.');
            }
            retryCount++;
        }
    }

    // Wait for settlement
    await page.waitForTimeout(2000);
    await waitForAppStability(page);

    // If we are not in the "channels" view, click the newly created space to enter it
    const newServerItem = page.locator(`.server-entry:has-text("${serverName}")`);
    if (await newServerItem.isVisible()) {
        console.log(`[createSpaceAndRoom] Clicked entry for "${serverName}" to ensure view transition.`);
        await newServerItem.click();
        await page.waitForTimeout(1000);
    }

    // Verify server title
    console.log(`[createSpaceAndRoom] Verifying server title: ${serverName}`);
    const titleLocator = page.locator('.server-title');
    await expect(titleLocator).toContainText(serverName, { timeout: 20000 });
    console.log('[createSpaceAndRoom] Server title verified.');

    // Now create a room
    console.log('[createSpaceAndRoom] Opening Room creation modal...');
    await page.click('button[title="Add..."]');
    await page.click('button:has-text("New Room")');
    
    await page.fill('input#room-name-modal', roomName);
    
    if (roomType !== 'text') {
        console.log(`[createSpaceAndRoom] Selecting room type: ${roomType}`);
        await page.selectOption('select#room-type-modal', roomType);
    }

    // Submit room with retry
    let roomRetryCount = 0;
    while (roomRetryCount <= 2) {
        console.log(`[createSpaceAndRoom] Submitting Room form (Attempt ${roomRetryCount + 1})...`);
        await page.click('button:has-text("Create Room")');
        
        const result = await Promise.race([
            page.locator('.modal-backdrop').waitFor({ state: 'detached', timeout: 5000 }).then(() => 'success'),
            page.locator('text="Rate limit exceeded"').waitFor({ state: 'visible', timeout: 5000 }).then(() => 'rate-limited'),
            page.waitForTimeout(5000).then(() => 'timeout')
        ]);

        if (result === 'success') {
            console.log('[createSpaceAndRoom] Room created and modal closed.');
            break;
        } else if (result === 'rate-limited') {
            await page.waitForTimeout(10000);
            roomRetryCount++;
        } else {
            roomRetryCount++;
        }
    }
    
    // Safety delay to allow Synapse provisioning to catch up
    console.log('[createSpaceAndRoom] Room creation submitted. Waiting 5s for provisioning...');
    await page.waitForTimeout(5000);
    
    await waitForAppStability(page);
    
    console.log(`[createSpaceAndRoom] Final check for room label: ${roomName}`);
    const roomItem = page.locator(`button.list-item:has-text("${roomName}")`).first();
    await expect(roomItem).toBeVisible({ timeout: 15000 });
    
    // Explicitly click the room and wait for chat input to be ready
    console.log(`[createSpaceAndRoom] Clicking room "${roomName}" to ensure join...`);
    await roomItem.click();
    
    const messageInput = page.getByPlaceholder(new RegExp(`Message #${roomName}`));
    await expect(messageInput).toBeVisible({ timeout: 20000 });
    await expect(messageInput).toBeEnabled({ timeout: 20000 });
    
    console.log('[createSpaceAndRoom] Flow complete and room is ready.');
}
