import { test, expect } from "@playwright/test";

/**
 * E2E test for the core review → approve → track flow, the one path that
 * every other feature in this app exists to support (see
 * docs/decisions/01-human-in-the-loop.md). Runs against a real dev server
 * and a real (test) Supabase project — it does not mock Supabase Auth or
 * the database, because the thing worth verifying end-to-end is that RLS,
 * the auth middleware, and the actual review UI agree with each other.
 *
 * Requires:
 * - the dev server running (or E2E_BASE_URL pointing at one)
 * - a test Supabase project matching supabase/migrations/001_initial.sql
 * - a test user, credentials in E2E_TEST_EMAIL / E2E_TEST_PASSWORD
 * - that user's data seeded via `npm run seed` (see scripts/seed.ts), which
 *   creates a pending draft for Ziina to review
 *
 * Skipped automatically when those credentials aren't set (e.g. a local
 * clone without a configured Supabase project) — see the CI workflow for
 * how this is wired up when secrets are present.
 */

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;

test.skip(!email || !password, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set — skipping live review-flow test.");

test.describe("review and approve flow", () => {
  test("sign in, open a pending draft, edit and approve it, then mark it sent from the tracker", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");

    await page.getByRole("link", { name: "Review" }).click();
    await expect(page).toHaveURL("/review");

    const firstDraft = page.locator("a").filter({ hasText: "Ziina" }).first();
    await firstDraft.click();

    await expect(page.getByRole("heading", { name: "Ziina" })).toBeVisible();

    const bodyField = page.locator("#body");
    await bodyField.fill(`${await bodyField.inputValue()}\n\nP.S. Great work on the recent product launch.`);

    await page.getByRole("button", { name: "Edit & Approve" }).click();
    await expect(page.getByText(/This draft is/)).toBeVisible();

    await page.getByRole("link", { name: "Tracker" }).click();
    await expect(page).toHaveURL("/tracker");

    const trackerRow = page.locator("div").filter({ hasText: "Ziina" }).first();
    await trackerRow.getByRole("button", { name: "Mark sent" }).click();

    await expect(page.getByText(/Sent/).first()).toBeVisible();
  });
});
