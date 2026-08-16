import { defineConfig, devices } from "@playwright/test";

/**
 * Keep the same browser matrix locally and in CI. The workflow installs the
 * Playwright-managed binaries that match this package version and runs every
 * project explicitly so a browser cannot be silently skipped.
 *
 * To run all browsers locally:
 *   pnpm exec playwright test --project=chromium --project=firefox --project=webkit
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: process.env.CI ? 90_000 : 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: process.env.CI ? 30_000 : 10_000,
    navigationTimeout: process.env.CI ? 60_000 : 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
