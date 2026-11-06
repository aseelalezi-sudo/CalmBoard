import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const password = "CalmBoard-E2E-Password-2026!";
export const arabic = {
  createAccount: "\u0625\u0646\u0634\u0627\u0621 \u062d\u0633\u0627\u0628",
  submitAccount: "\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062d\u0633\u0627\u0628",
  openAccountMenu: "\u0641\u062a\u062d \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062d\u0633\u0627\u0628",
  toggleLanguage: "\u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u0644\u063a\u0629",
};

export async function registerIsolatedOwner(page: Page) {
  const suffix = randomUUID();
  const identity = {
    email: `e2e-${suffix}@example.test`,
    name: `E2E Owner ${suffix.slice(0, 8)}`,
    organization: `E2E Organization ${suffix.slice(0, 8)}`,
    workspace: `E2E Workspace ${suffix.slice(0, 8)}`,
  };

  await page.goto("/");
  await page.getByRole("tab", { name: arabic.createAccount }).click();
  await page.locator('input[name="name"]').fill(identity.name);
  await page.locator('input[name="organizationName"]').fill(identity.organization);
  await page.locator('input[name="workspaceName"]').fill(identity.workspace);
  await page.locator('input[name="email"]').fill(identity.email);
  await page.locator('input[name="password"]').fill(password);
  if (await page.locator('input[name="passwordConfirmation"]').isVisible()) {
    await page.locator('input[name="passwordConfirmation"]').fill(password);
  }

  const registration = page.waitForResponse(
    (response) => response.url().endsWith("/auth/register") && response.request().method() === "POST",
  );
  await page.locator('button[type="submit"]').click();
  expect((await registration).ok()).toBe(true);

  await page.getByRole("button", { name: arabic.openAccountMenu }).click();
  const englishButton = page.getByRole("button", { name: /English/i });
  if (await englishButton.isVisible()) {
    await englishButton.click();
  } else {
    const languageToggle = page.getByRole("menuitem", { name: arabic.toggleLanguage });
    await expect(languageToggle).toBeVisible();
    await languageToggle.click();
  }
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText(identity.workspace, { exact: true }).first()).toBeVisible();
  return identity;
}
