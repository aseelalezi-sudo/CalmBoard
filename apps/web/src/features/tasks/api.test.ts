import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskRecord,
  getTaskDetailBundle,
  importTaskRecords,
  moveTaskRecord,
  setProjectWipLimit,
  updateTaskRecord,
} from "./api";

test("tasks API service", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test("sends scoped task mutations as JSON", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: "task-1", serial: "TASK-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await createTaskRecord({
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      actorId: "user-1",
      title: "New task",
    });
    await updateTaskRecord({
      id: "task-1",
      expectedVersion: 3,
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      status: "done",
    });
    await importTaskRecords({
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      tasks: [{ projectId: "project-1", title: "Imported task" }],
    });

    assert.equal(requests.length, 3);
    assert.equal(requests[0]?.url, "http://localhost:5500/tasks");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal(typeof (requests[0]?.init?.headers as Record<string, string>)["Idempotency-Key"], "string");
    assert.equal(requests[1]?.init?.method, "PATCH");
    assert.equal(requests[2]?.url, "http://localhost:5500/tasks/import");
    assert.equal(typeof (requests[2]?.init?.headers as Record<string, string>)["Idempotency-Key"], "string");
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
      id: "task-1",
      expectedVersion: 3,
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      status: "done",
    });
  });

  await t.test("loads scoped details and subtasks as one bundle", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      const pathname = new URL(url).pathname;
      const payload =
        pathname === "/tasks/project%2Ftask"
          ? {
              task: { id: "project/task", title: "Loaded task" },
              comments: [{ id: "comment-1" }],
              attachments: [{ id: "attachment-1" }],
              checklists: [{ id: "checklist-1" }],
              approvals: [{ id: "approval-1" }],
            }
          : [{ id: "subtask-1" }];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const bundle = await getTaskDetailBundle({
      id: "project/task",
      organizationId: "organization/a",
      workspaceId: "workspace/a",
    });

    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls.every((url) => !url.includes("project/task")));
    assert.equal(bundle.task.title, "Loaded task");
    assert.equal(bundle.comments[0]?.id, "comment-1");
    assert.equal(bundle.attachments[0]?.id, "attachment-1");
    assert.equal(bundle.subtasks[0]?.id, "subtask-1");
    assert.equal(bundle.checklists[0]?.id, "checklist-1");
    assert.equal(bundle.approvals[0]?.id, "approval-1");
  });

  await t.test("sends atomic board moves and persisted WIP limits", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await moveTaskRecord(
      {
        id: "task/1",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        version: 7,
      },
      "in_progress",
      2,
      { beforeTaskId: "task-0", afterTaskId: "task-2" },
      "user-1",
    );
    await setProjectWipLimit(
      {
        id: "project/1",
        organizationId: "organization-1",
        workspaceId: "workspace-1",
      },
      "in_progress",
      4,
      "user-1",
    );

    assert.equal(requests[0]?.url, "http://localhost:5500/tasks/task%2F1/move");
    assert.equal(requests[0]?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      status: "in_progress",
      targetIndex: 2,
      beforeTaskId: "task-0",
      afterTaskId: "task-2",
      expectedVersion: 7,
    });
    assert.equal(requests[1]?.url, "http://localhost:5500/projects/project%2F1/wip-limits");
    assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      status: "in_progress",
      limit: 4,
    });
  });
});
