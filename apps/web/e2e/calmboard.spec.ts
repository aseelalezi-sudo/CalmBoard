import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = "CalmBoard-E2E-Password-2026!";
const arabic = {
  createAccount: "\u0625\u0646\u0634\u0627\u0621 \u062d\u0633\u0627\u0628",
  submitAccount: "\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u062d\u0633\u0627\u0628",
  openAccountMenu: "\u0641\u062a\u062d \u0642\u0627\u0626\u0645\u0629 \u0627\u0644\u062d\u0633\u0627\u0628",
  toggleLanguage: "\u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u0644\u063a\u0629",
};

async function registerIsolatedOwner(page: Page) {
  const suffix = randomUUID();
  const identity = {
    email: `e2e-${suffix}@example.test`,
    name: `E2E Owner ${suffix.slice(0, 8)}`,
    organization: `E2E Organization ${suffix.slice(0, 8)}`,
    workspace: `E2E Workspace ${suffix.slice(0, 8)}`,
  };

  await page.goto("/");
  await page.getByRole("button", { name: arabic.createAccount, exact: true }).click();
  await page.locator('input[name="name"]').fill(identity.name);
  await page.locator('input[name="organizationName"]').fill(identity.organization);
  await page.locator('input[name="workspaceName"]').fill(identity.workspace);
  await page.locator('input[name="email"]').fill(identity.email);
  await page.locator('input[name="password"]').fill(password);

  const registration = page.waitForResponse(
    (response) => response.url().endsWith("/auth/register") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: arabic.submitAccount, exact: true }).click();
  expect((await registration).ok()).toBe(true);

  await page.getByRole("button", { name: arabic.openAccountMenu }).click();
  const languageToggle = page.getByRole("menuitem", { name: arabic.toggleLanguage });
  await expect(languageToggle).toBeVisible();
  await languageToggle.click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByText(identity.workspace, { exact: true }).first()).toBeVisible();
  return identity;
}

test.describe("CalmBoard core acceptance", () => {
  test("owner creates a project, task, subtask, and comment through the real UI", async ({ page }) => {
    test.setTimeout(60_000);
    const identity = await registerIsolatedOwner(page);
    const projectName = `Launch ${randomUUID().slice(0, 8)}`;
    const taskName = `Acceptance task ${randomUUID().slice(0, 8)}`;
    const subtaskName = `Acceptance subtask ${randomUUID().slice(0, 8)}`;
    const commentText = `Acceptance comment ${randomUUID().slice(0, 8)}`;

    const projectsNavigation = page.getByRole("button", { name: "Projects", exact: true });
    await expect(projectsNavigation).toBeVisible();
    await projectsNavigation.click();
    await page.getByRole("button", { name: "New Project", exact: true }).first().click();
    await expect(page.getByText("New Project & Starter Kit", { exact: true })).toBeVisible();
    await page.getByPlaceholder(/Project name/).fill(projectName);
    await page.getByPlaceholder("Description & goals...").fill("Created by the Playwright acceptance suite");
    await page.getByRole("button", { name: "Create with Starter Kit" }).click();

    await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /New Task/ }).click();
    await page.getByPlaceholder("What needs to be done?").fill(taskName);
    await page.getByPlaceholder("Detailed description (optional)\u2026").fill("Core acceptance task");
    await page.getByRole("button", { name: "Create task", exact: true }).last().click();

    await expect(page.getByText("Advanced task grid", { exact: true })).toBeVisible();
    await expect(page.getByText(taskName, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByText(taskName, { exact: true }).click();
    await expect(page.getByText("Subtasks", { exact: true })).toBeVisible();

    await page.getByPlaceholder("New subtask\u2026").fill(subtaskName);
    const subtaskRequest = page.waitForResponse(
      (response) => response.url().includes("/tasks") && response.request().method() === "POST",
    );
    await page.getByPlaceholder("New subtask\u2026").press("Enter");
    expect((await subtaskRequest).ok()).toBe(true);
    await expect(page.getByText(subtaskName, { exact: true })).toBeVisible();

    await page.getByPlaceholder("Write a comment\u2026 (@ to mention)").fill(commentText);
    const commentRequest = page.waitForResponse(
      (response) => response.url().endsWith("/comments") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    expect((await commentRequest).ok()).toBe(true);
    await expect(page.getByText(commentText, { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByText(identity.workspace, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
    await expect(page.getByText(taskName, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Board", exact: true }).click();
    for (const status of ["Backlog", "To Do", "In Progress", "Review", "Done"]) {
      await expect(page.locator(".column-drop").filter({ hasText: status })).toBeVisible();
    }
    await expect(page.getByText(taskName, { exact: true })).toBeVisible();
  });

  test("public OpenAPI reference exposes the core task and AI contracts", async ({ page }) => {
    await page.goto("/api-reference");
    await expect(page.getByRole("heading", { name: /REST API/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "/tasks get" })).toBeVisible();
    await expect(page.getByRole("button", { name: "/ai post" })).toBeVisible();
  });
});
