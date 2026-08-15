import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("dense screen responsive layout", () => {
  it("shows one role at a time on mobile and keeps the comparison matrix for larger screens", () => {
    const permissions = source("../permissions/permissions-view.tsx");
    assert.match(permissions, /const \[mobileRoleId, setMobileRoleId\]/);
    assert.match(permissions, /className="p-3 md:hidden"/);
    assert.match(permissions, /hidden overflow-x-auto overscroll-x-contain md:block/);
  });

  it("uses compact project cards instead of a wide table on mobile", () => {
    const projects = source("../projects/projects-view.tsx");
    assert.match(projects, /className="space-y-3 md:hidden"/);
    assert.match(projects, /hidden overflow-hidden rounded-2xl.*md:block/);
    assert.match(projects, /overflow-x-auto overscroll-x-contain/);
  });

  it("uses native mobile week and month calendar layouts instead of wide hidden grids", () => {
    const calendar = source("../tasks/advanced-task-calendar.tsx");
    assert.match(calendar, /className="space-y-2 p-3 sm:hidden"/);
    assert.match(calendar, /className="p-2 sm:hidden"/);
    assert.match(calendar, /hidden overflow-x-auto overscroll-x-contain sm:block/);
    assert.match(calendar, /setMode\("day"\)/);
  });
});
