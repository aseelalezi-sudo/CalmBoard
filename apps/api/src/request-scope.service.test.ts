import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { explicitRequestScope } from "./request-scope.service.js";

describe("canonical HTTP request scope", () => {
  it("includes named and conventional project route parameters", () => {
    assert.equal(
      explicitRequestScope({
        url: "/api/projects/project-a/sprints",
        params: { projectId: "project-a" },
        query: { organizationId: "organization-a", workspaceId: "workspace-a" },
      }).projectId,
      "project-a",
    );
    assert.equal(
      explicitRequestScope({
        url: "/projects/project-a/archive",
        params: { id: "project-a" },
        body: { organizationId: "organization-a", workspaceId: "workspace-a" },
      }).projectId,
      "project-a",
    );
  });

  it("rejects body or query scope that conflicts with the route parameter", () => {
    assert.throws(
      () =>
        explicitRequestScope({
          url: "/api/projects/project-a/sprints",
          params: { projectId: "project-a" },
          body: { projectId: "project-b" },
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        explicitRequestScope({
          url: "/api/projects/project-a/sprints",
          params: { projectId: "project-a" },
          query: { projectId: "project-b" },
        }),
      BadRequestException,
    );
  });

  it("captures trusted-resource identifiers for task and Sprint routes", () => {
    const scope = explicitRequestScope({
      url: "/api/projects/project-a/sprints/sprint-a/tasks/task-a/move",
      params: { projectId: "project-a", sprintId: "sprint-a", taskId: "task-a" },
      body: {
        targetSprintId: "sprint-b",
        incompleteTaskDestination: { type: "sprint", sprintId: "sprint-c" },
      },
    });
    assert.deepEqual(scope.resources.taskIds, ["task-a"]);
    assert.deepEqual(scope.resources.sprintIds, ["sprint-a", "sprint-b", "sprint-c"]);
  });
});
