import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCreateProjectRequest } from "./project-validation.js";

describe("project request input", () => {
  it("accepts the complete project field set", () => {
    const request = parseCreateProjectRequest({
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      actorId: "user-1",
      name: "Launch",
      coverUrl: "https://example.test/cover.png",
      managerId: "user-2",
      memberIds: ["user-3"],
      teamIds: ["team-1"],
      startDate: "2026-08-01T00:00:00.000Z",
      endDate: "2026-09-01T00:00:00.000Z",
      privacy: "private-members",
      template: "roadmap",
      progress: 20,
      budget: 5000,
      estimatedHours: 120,
      loggedHours: 15,
    });

    assert.equal(request.input.managerId, "user-2");
    assert.deepEqual(request.input.teamIds, ["team-1"]);
    assert.ok(request.input.startDate instanceof Date);
  });

  it("rejects unsupported fields and invalid ranges", () => {
    assert.throws(
      () =>
        parseCreateProjectRequest({
          organizationId: "organization-1",
          workspaceId: "workspace-1",
          name: "Launch",
          admin: true,
        }),
      /Unrecognized key/,
    );
    assert.throws(
      () =>
        parseCreateProjectRequest({
          organizationId: "organization-1",
          workspaceId: "workspace-1",
          name: "Launch",
          progress: 101,
        }),
      /progress/,
    );
  });
});
