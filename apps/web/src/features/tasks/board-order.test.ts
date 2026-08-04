import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Task } from "@/lib/types";
import { reorderBoardTasks } from "./board-order";

function task(id: string, status: string, order: number): Task {
  return {
    id,
    serial: id,
    title: id,
    status,
    priority: "medium",
    projectId: "project-1",
    workspaceId: "workspace-1",
    organizationId: "organization-1",
    tags: [],
    progress: 0,
    order,
    timezone: "UTC",
    createdAt: "2026-07-29T00:00:00.000Z",
    version: 1,
  };
}

describe("optimistic Kanban ordering", () => {
  it("reorders within a status and normalizes persisted order values", () => {
    const result = reorderBoardTasks(
      [task("first", "todo", 0), task("second", "todo", 1), task("third", "todo", 2)],
      "first",
      "todo",
      2,
    );
    assert.deepEqual(
      result.filter((item) => item.status === "todo").map((item) => [item.id, item.order]),
      [
        ["second", 0],
        ["third", 1],
        ["first", 2],
      ],
    );
  });

  it("moves across statuses and completes a task moved to done", () => {
    const result = reorderBoardTasks([task("moving", "todo", 0), task("existing", "done", 0)], "moving", "done", 1);
    assert.deepEqual(
      result.filter((item) => item.status === "done").map((item) => [item.id, item.order]),
      [
        ["existing", 0],
        ["moving", 1],
      ],
    );
    assert.equal(result.find((item) => item.id === "moving")?.progress, 100);
  });
});
