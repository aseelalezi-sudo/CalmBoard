import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const views = readFileSync(new URL("./task-views.tsx", import.meta.url), "utf8");

describe("My Work view contracts and hardening", () => {
  it("filters assigned non-deleted tasks and provides 5 distinct lifecycle sections", () => {
    // Assigned filter (matching Lead and Contributors)
    assert.match(
      views,
      /ctx\.tasks\.filter\(\(task\) => !task\.deletedAt && isTaskAssignedTo\(task, ctx\.currentUser\?\.id\)\)/,
    );

    // Active status filter (excluding done, canceled, cancelled)
    assert.match(
      views,
      /mine\.filter\([\s\S]*?task\.status !== "done"[\s\S]*?task\.status !== "canceled"[\s\S]*?task\.status !== "cancelled"/,
    );

    // 5 sections: today, upcoming, overdue, no_due_date, done
    assert.match(views, /id: "today"/);
    assert.match(views, /id: "upcoming"/);
    assert.match(views, /id: "overdue"/);
    assert.match(views, /id: "no_due_date"/);
    assert.match(views, /id: "done"/);
  });

  it("enforces deterministic sorting in all My Work sections", () => {
    // Priority order map definition
    assert.match(views, /const PRIORITY_ORDER: Record<string, number> = {/);

    // Due today sorted by priority then serial
    assert.match(views, /PRIORITY_ORDER\[b\.priority\][\s\S]*a\.serial\.localeCompare\(b\.serial\)/);

    // Overdue sorted by due date then priority then serial
    assert.match(views, /a\.dueDate[\s\S]*localeCompare[\s\S]*PRIORITY_ORDER/);
  });

  it("protects task toggle mutations with optimistic expectedVersion", () => {
    assert.match(views, /expectedVersion: task\.version/);
    assert.match(views, /saved = await ctx\.updateTask/);
    assert.match(views, /aria-busy=\{pendingTaskId === task\.id\}/);
  });
});
