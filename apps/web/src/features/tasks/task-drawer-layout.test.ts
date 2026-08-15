import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const drawer = readFileSync(new URL("./task-drawer.tsx", import.meta.url), "utf8");

describe("task drawer interaction contract", () => {
  it("splits the long workflow into focused sections", () => {
    assert.match(drawer, /activeSection.*"details"/);
    assert.match(drawer, /id: "work"/);
    assert.match(drawer, /id: "activity"/);
    assert.match(drawer, /aria-label=\{ctx\.t\("أقسام المهمة", "Task sections"\)\}/);
  });

  it("commits noisy title and progress controls after interaction", () => {
    assert.match(drawer, /onBlur=\{commitTitle\}/);
    assert.match(drawer, /onPointerUp=\{commitProgress\}/);
    assert.match(drawer, /onKeyUp=\{commitProgress\}/);
  });

  it("supports modal keyboard behavior and page scroll locking", () => {
    assert.match(drawer, /event\.key === "Escape"/);
    assert.match(drawer, /document\.body\.style\.overflow = "hidden"/);
    assert.match(drawer, /aria-modal="true"/);
  });
});
