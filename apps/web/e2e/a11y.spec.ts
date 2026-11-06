/**
 * Accessibility smoke-test suite (WCAG 2.1 AA)
 *
 * These tests run on the complete Playwright browser matrix.
 *
 * Covered screens:
 *   - Landing / registration (public, unauthenticated)
 *   - Public API reference (/api-reference)
 *   - Authenticated workspace dashboard (isolated owner registration)
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { registerIsolatedOwner } from "./auth";

// The app shortens animations under this preference. Otherwise an axe scan can
// run while a screen is still fading in and report the temporary opacity as a
// color-contrast failure.
test.use({ reducedMotion: "reduce" });

test.describe("Accessibility (WCAG 2.1 AA)", () => {
  test("landing / login page has no automatically detectable violations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

    expect(
      results.violations,
      `WCAG violations on /:\n${results.violations.map((v) => `  [${v.id}] ${v.description}`).join("\n")}`,
    ).toEqual([]);
  });

  test("public API reference page has no automatically detectable violations", async ({ page }) => {
    await page.goto("/api-reference");
    await page.waitForLoadState("domcontentloaded");

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

    expect(
      results.violations,
      `WCAG violations on /api-reference:\n${results.violations.map((v) => `  [${v.id}] ${v.description}`).join("\n")}`,
    ).toEqual([]);
  });
});

test.describe("Authenticated accessibility (WCAG 2.1 AA)", () => {
  test("workspace dashboard has no automatically detectable violations", async ({ page }) => {
    test.setTimeout(120_000);
    const identity = await registerIsolatedOwner(page);
    await expect(page.getByRole("button", { name: "Projects", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dashboard & Analytics", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Customize dashboard", exact: true })).toBeEnabled();

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

    expect(
      results.violations,
      `WCAG violations on the authenticated dashboard (${identity.workspace}):\n${results.violations
        .map((v) => `  [${v.id}] ${v.description}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
