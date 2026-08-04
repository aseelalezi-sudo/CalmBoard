import assert from "node:assert/strict";
import test from "node:test";
import type { Task } from "@/lib/types";
import { parseTaskClipboard, serializeTasksForClipboard, TASK_CLIPBOARD_COLUMNS } from "./task-table-clipboard";

const task = {
  id: "task-1",
  serial: "TASK-1",
  title: "Plan launch",
  status: "in_progress",
  priority: "high",
  assigneeId: "user-1",
  projectId: "project-1",
  workspaceId: "workspace-1",
  organizationId: "organization-1",
  tags: [],
  progress: 40,
  order: 0,
  timezone: "UTC",
  storyPoints: 8,
  estimatedHours: 12,
  dueDate: "2026-08-10T12:00:00.000Z",
  createdAt: "2026-07-29T00:00:00.000Z",
  version: 1,
} satisfies Task;

test("task table clipboard format", async (t) => {
  await t.test("round-trips editable task fields as TSV", () => {
    const encoded = serializeTasksForClipboard([task]);
    assert.equal(encoded.split("\n")[0], TASK_CLIPBOARD_COLUMNS.join("\t"));
    assert.deepEqual(parseTaskClipboard(encoded), [
      {
        title: "Plan launch",
        status: "in_progress",
        priority: "high",
        assigneeId: "user-1",
        storyPoints: 8,
        estimatedHours: 12,
        dueDate: "2026-08-10T00:00:00.000Z",
      },
    ]);
  });

  await t.test("rejects unknown headers, unsafe values, and oversized batches", () => {
    assert.throws(() => parseTaskClipboard("title\tstatus\nTask\tdone"), /header/);
    assert.throws(
      () => parseTaskClipboard(`${TASK_CLIPBOARD_COLUMNS.join("\t")}\nTask\tinvalid\thigh\t\t1\t2\t2026-08-10`),
      /unsupported status/,
    );
    assert.throws(
      () => parseTaskClipboard(`${TASK_CLIPBOARD_COLUMNS.join("\t")}\nTask\tdone\thigh\t\t-1\t2\t2026-08-10`),
      /storyPoints/,
    );
    assert.throws(
      () => parseTaskClipboard(`${TASK_CLIPBOARD_COLUMNS.join("\t")}\nTask\tdone\thigh\t\t1\t2\t2026-02-30`),
      /dueDate/,
    );
    assert.throws(
      () => parseTaskClipboard([TASK_CLIPBOARD_COLUMNS.join("\t"), ...Array(501).fill("x")].join("\n")),
      /limited to 500/,
    );
  });
});
