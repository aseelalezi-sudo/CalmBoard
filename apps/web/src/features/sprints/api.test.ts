import assert from "node:assert/strict";
import test from "node:test";
import { completeSprint, listSprints, moveTaskToSprint, type SprintScope } from "./api";
import { sprintQueryKeys } from "./query-keys";

const scope: SprintScope = {
  organizationId: "organization/a",
  workspaceId: "workspace/a",
  projectId: "project/a",
  actorId: "user/a",
};

test("Sprint API follows the implemented scoped routes and atomic movement contract", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      JSON.stringify(init?.method === "POST" ? { ok: true, sprint: { id: "s1" } } : { ok: true, sprints: [] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  await listSprints(scope);
  await moveTaskToSprint("task/a", "sprint/target", null, scope);
  await completeSprint("sprint/active", { type: "sprint", sprintId: "sprint/next" }, scope);

  const listUrl = new URL(requests[0]!.url);
  assert.equal(listUrl.pathname, "/api/projects/project/a/sprints");
  assert.equal(listUrl.searchParams.get("organizationId"), "organization/a");

  const moveBody = JSON.parse(String(requests[1]!.init?.body));
  assert.equal(new URL(requests[1]!.url).pathname, "/api/projects/project/a/sprints/sprint/target/tasks/task/a/move");
  assert.equal(moveBody.targetSprintId, "sprint/target");
  assert.equal(moveBody.expectedFromSprintId, null);

  const completeBody = JSON.parse(String(requests[2]!.init?.body));
  assert.deepEqual(completeBody.incompleteTaskDestination, { type: "sprint", sprintId: "sprint/next" });
});

test("Sprint query keys cannot leak across workspace or project contexts", () => {
  const first = sprintQueryKeys.project(scope);
  const anotherProject = sprintQueryKeys.project({ ...scope, projectId: "project/b" });
  const anotherWorkspace = sprintQueryKeys.project({ ...scope, workspaceId: "workspace/b" });
  assert.notDeepEqual(first, anotherProject);
  assert.notDeepEqual(first, anotherWorkspace);
});
