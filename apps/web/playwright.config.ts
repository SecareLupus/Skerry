import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './e2e',
  // Feature specs reset + re-bootstrap the platform in `beforeEach`, which
  // would race if they ran in parallel. Keep execution serial.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // E2E scenarios touch SSE + WebRTC + multiple browser contexts; first-run
  // flakes are common. One retry locally absorbs the most common transients
  // without masking genuine breakage.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    video: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ]
        }
      },
    },
  ],
  /* webServer: {
    command: 'cd ../.. && npx dotenv-cli -e .env -- pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  }, */
});
