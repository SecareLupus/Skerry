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
  console.log(`[setupAndLogin] Starting for user: ${username}`);
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

  // 1. Initial Login
  console.log('[setupAndLogin] Waiting for dev login form...');
  await page.waitForSelector('input[id="dev-username"]');
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
    await page.fill('input[id="setup-token"]', 'bootstrap_token');
    await Promise.all([
      page.waitForResponse(res => res.url().includes('/auth/bootstrap-admin') && res.status() === 201),
      page.click('button:has-text("Bootstrap Admin + Hub")')
    ]);
    console.log('[setupAndLogin] Bootstrap submitted, waiting for reload...');
    await page.waitForSelector('text="Loading local workspace..."', { state: 'detached', timeout: 10000 });
  }

  // 5. Final stability check
  console.log('[setupAndLogin] Finalizing stability...');
  await waitForAppStability(page);
  console.log('[setupAndLogin] Login flow complete.');
}

/**
 * Waits for the app to be in a stable "Live" or "Polling" state.
 */
export async function waitForAppStability(page: Page) {
  console.log('[stability] Waiting for sidebar and status pill...');
  await page.waitForSelector('.unified-sidebar', { timeout: 15000 });
  
  const statusPill = page.locator('.status-pill');
  await page.waitForFunction(() => {
    const pill = document.querySelector('.status-pill');
    const state = pill?.getAttribute('data-state');
    console.log(`[stability] Current state check: ${state}`);
    return state === 'live' || state === 'polling';
  }, { timeout: 15000 });

  console.log('[stability] State reached live/polling, pausing for layout settle.');
  await page.waitForTimeout(1000);
}

/**
 * Helper to create a new space and room for test isolation if needed.
 */
export async function createSpaceAndRoom(page: Page, serverName: string, roomName: string) {
    console.log(`[createSpaceAndRoom] Target: Space="${serverName}", Room="${roomName}"`);
    
    // Ensure we are stable first
    await waitForAppStability(page);

    // Go back to server list to make sure we are at the root
    console.log('[createSpaceAndRoom] Clicking Back to Servers...');
    const backBtn = page.locator('button[title="Back to Servers"]');
    if (await backBtn.isVisible()) {
        await backBtn.click();
        // Wait for Server list to appear
        await page.waitForSelector('h2:has-text("Servers")', { timeout: 5000 }).catch(() => {
            console.warn('[createSpaceAndRoom] Server list heading not found after clicking back.');
        });
    }
    
    // Open Create Space modal
    console.log('[createSpaceAndRoom] Opening Create Space modal...');
    const createBtn = page.locator('button[aria-label="Create Space"]');
    if (!(await createBtn.isVisible())) {
        console.error('[createSpaceAndRoom] Create Space button (+) NOT VISIBLE.');
        // Debug info: check for admin role in the page state if possible
        const roles = await page.evaluate(() => (window as any).state?.viewerRoles);
        console.error(`[createSpaceAndRoom] Current Viewer Roles: ${JSON.stringify(roles)}`);
        
        // Take diagnostic screenshot
        await page.screenshot({ path: `playwright-report/missing-create-btn-${Date.now()}.png` });
        
        throw new Error('Create Space button not found - User may lack hub_admin permissions.');
    }
    
    await createBtn.click();
    await page.waitForTimeout(1000); // Hydration buffer
    
    // Fill form
    await page.fill('input#space-name-modal', serverName);

    // Diagnostic: take screenshot before click
    await page.screenshot({ path: `playwright-report/pre-submit-space-${Date.now()}.png` });
    
    // Submit
    console.log(`[createSpaceAndRoom] Submitting form via button click. value: ${await page.inputValue('input#space-name-modal')}`);
    // Wait for the button to be ready so we know React has hydrated the form
    const submitBtn = page.locator('button[type="submit"]:has-text("Create Space")');
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });

    const hubsState = await page.evaluate(() => (window as any).state?.hubs);
    console.log(`[createSpaceAndRoom] Current hubs in state: ${JSON.stringify(hubsState)}`);

    // Ensure we select a hub if there are multiple.
    if (hubsState && hubsState.length > 1) {
       console.log(`[createSpaceAndRoom] Multiple hubs detected, selecting the first one explicitly.`);
       await page.selectOption('select#hub-selection', hubsState[0].id);
    }

    await submitBtn.click();

    console.log('[createSpaceAndRoom] Form submitted, waiting for completion...');
    // Make sure modal goes away. If it doesn't, that's our failure!
    const modalBackdrop = page.locator('.modal-backdrop');
    try {
        await expect(modalBackdrop).toHaveCount(0, { timeout: 5000 });
        console.log('[createSpaceAndRoom] Modal closed successfully.');
    } catch (e) {
        console.error('[createSpaceAndRoom] Modal FAILED to close!');
        await page.screenshot({ path: `playwright-report/modal-stuck-${Date.now()}.png` });
        throw e;
    }

    console.log(`[createSpaceAndRoom] URL after form submission: ${page.url()}`);

    // Wait for settlement
    await page.waitForTimeout(2000); // UI transition buffer
    await waitForAppStability(page);

    // Verify server title - Try multiple locators for resilience
    console.log(`[createSpaceAndRoom] Waiting for server title: ${serverName}`);
    try {
        const titleLocator = page.locator('.server-title');
        await expect(titleLocator).toHaveText(serverName, { timeout: 15000 });
        console.log('[createSpaceAndRoom] Server title found successfully.');
    } catch (err) {
        console.error('[createSpaceAndRoom] Failed to find server title. Dumping sidebar state:');
        const sidebarText = await page.innerText('.unified-sidebar').catch(() => 'UNABLE TO READ SIDEBAR');
        console.error('--- SIDEBAR CONTENT START ---');
        console.error(sidebarText);
        console.error('--- SIDEBAR CONTENT END ---');
        
        // Take a screenshot for debugging
        const screenshotPath = `playwright-report/fail-create-space-${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath });
        console.error(`[createSpaceAndRoom] Saved debug screenshot to: ${screenshotPath}`);
        
        throw err;
    }

    // Now create a room
    console.log('[createSpaceAndRoom] Opening Room creation modal...');
    await page.click('button[title="Add..."]');
    await page.click('button:has-text("New Room")');
    
    await page.fill('input#room-name-modal', roomName);
    await page.click('button:has-text("Create Room")');
    
    // Stability after room creation
    await page.waitForTimeout(1000);
    await waitForAppStability(page);
    
    console.log(`[createSpaceAndRoom] Waiting for room label: ${roomName}`);
    await expect(page.locator(`button.list-item:has-text("${roomName}")`)).toBeVisible({ timeout: 15000 });
    console.log('[createSpaceAndRoom] Space and room creation successful.');
}
