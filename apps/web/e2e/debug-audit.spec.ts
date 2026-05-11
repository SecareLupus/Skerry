import { test } from '@playwright/test';

test('debug audit-log page', async ({ page }) => {
    await page.goto('/settings/spaces/test123/audit-log');
    await page.waitForTimeout(3000);
    console.log('FINAL URL:', page.url());
    const h1s = page.locator('h1');
    const count = await h1s.count();
    console.log('H1 count:', count);
    for (let i = 0; i < count; i++) {
        console.log(`H1[${i}]:`, await h1s.nth(i).textContent());
    }
});
