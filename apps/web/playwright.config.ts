import { defineConfig, devices } from '@playwright/test';
import path from 'path';

export default defineConfig({
  testDir: './e2e',
  // Database-backed tests usually need to run sequentially to avoid state collisions
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Enforce sequential execution on the shared Docker stack
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  use: {
    // Point to the Caddy proxy
    baseURL: 'http://localhost',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer disabled: We test against the managed Docker Compose stack
});
