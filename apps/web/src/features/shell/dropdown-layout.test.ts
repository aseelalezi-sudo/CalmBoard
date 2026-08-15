import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("dropdown viewport and focus contract", () => {
  it("keeps topbar account and project menus inside the mobile viewport", () => {
    const user = source("./user-profile-dropdown.tsx");
    const project = source("./project-switcher-dropdown.tsx");
    assert.match(user, /fixed inset-x-2 top-\[4\.5rem\]/);
    assert.match(project, /fixed inset-x-2 top-\[4\.5rem\]/);
    assert.match(user, /100dvh/);
  });

  it("keeps sidebar switchers bounded and restores trigger focus after selection", () => {
    const workspace = source("./workspace-switcher-dropdown.tsx");
    const project = source("./project-switcher-dropdown.tsx");
    assert.match(workspace, /max-h-\[calc\(100dvh-1rem\)\]/);
    assert.match(workspace, /triggerRef\.current\?\.focus/);
    assert.match(project, /triggerRef\.current\?\.focus/);
  });

  it("supports Escape and focus restoration for notifications", () => {
    const shell = source("./calmboard-app.tsx");
    assert.match(shell, /event\.key === "Escape"/);
    assert.match(shell, /notifTriggerRef\.current\?\.focus/);
    assert.match(shell, /ref=\{notifPanelRef\}/);
    assert.match(shell, /tabIndex=\{-1\}/);
  });

  it("pins document templates to the phone viewport", () => {
    const docs = source("../docs/docs-view.tsx");
    assert.match(docs, /fixed inset-x-2 top-24.*sm:absolute/);
  });
});
