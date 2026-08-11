import assert from "node:assert/strict";
import test from "node:test";
import type { Project } from "@/lib/types";
import { archiveProjectRecord, deleteProjectRecord, restoreProjectRecord, updateProjectRecord } from "./actions-api";

test("project actions keep tenant scope and optimistic version on every mutation", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "project/1", version: 8 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const project: Project = {
    id: "project/1",
    organizationId: "organization-1",
    workspaceId: "workspace-1",
    name: "Launch",
    color: "#6366f1",
    icon: "folder",
    status: "active",
    priority: "high",
    progress: 25,
    version: 7,
  };
  const scope = {
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    actorId: "user-1",
  };

  await updateProjectRecord(project.id, { ...scope, expectedVersion: project.version, name: "Updated" });
  await archiveProjectRecord(project, scope);
  await restoreProjectRecord({ ...project, status: "archived" }, scope);
  await deleteProjectRecord(project, scope);

  assert.deepEqual(
    requests.map((request) => [request.url, request.init?.method]),
    [
      ["http://localhost:5500/projects/project%2F1", "PATCH"],
      ["http://localhost:5500/projects/project%2F1/archive", "POST"],
      ["http://localhost:5500/projects/project%2F1/restore", "POST"],
      ["http://localhost:5500/projects/project%2F1", "DELETE"],
    ],
  );
  for (const request of requests) {
    const body = JSON.parse(String(request.init?.body));
    assert.equal(body.organizationId, "organization-1");
    assert.equal(body.workspaceId, "workspace-1");
    assert.equal(body.actorId, "user-1");
    assert.equal(body.expectedVersion, 7);
  }
});
