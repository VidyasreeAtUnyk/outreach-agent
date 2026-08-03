import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the review/approve flow. Runs against a real dev server
 * and a real (test) Supabase project — see tests/e2e/review-flow.spec.ts
 * for the required environment variables and seed data.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
