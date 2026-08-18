/**
 * Accessibility smoke-test suite (WCAG 2.1 AA)
 *
 * These tests run on the complete Playwright browser matrix.
 *
 * Covered screens:
 *   - Landing / registration (public, unauthenticated)
 *   - Public API reference (/api-reference)
 *
 * The authenticated dashboard is covered by the core acceptance suite via
 * the same browser, so axe violations there will surface in practice.
 */
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
