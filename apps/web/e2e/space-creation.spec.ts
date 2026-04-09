import { test, expect } from '@playwright/test';
import { setupAndLogin, resetTestEnvironment, createSpaceAndRoom } from './test-utils';

test.describe('Space Creation Flow', () => {
    test.beforeEach(async ({ page }) => {
        await resetTestEnvironment(page);
    });

    test('should allow an admin to create a new space and a room within it', async ({ page }) => {
        await setupAndLogin(page, 'local-admin');
        
        const spaceName = `Test Space ${Date.now()}`;
        const roomName = `test-room-${Date.now()}`;
        
        await createSpaceAndRoom(page, spaceName, roomName);
        
        // Final assertion: we should be in the new room
        const activeRoom = page.locator('button.active:has-text("' + roomName + '")');
        await expect(activeRoom).toBeVisible();
    });
});
