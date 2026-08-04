import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { projectMembers, taskAssignees, taskFollowers } from "./schema.js";

describe("project and task participant schema", () => {
  it("keeps every participant relation directly tenant-scoped", () => {
    for (const table of [projectMembers, taskAssignees, taskFollowers]) {
      const columns = getTableColumns(table);
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, true);
      assert.equal(columns.projectId.notNull, true);
      assert.equal(columns.userId.notNull, true);
    }
  });

  it("supports project ownership, multiple assignees, and follower lifecycle", () => {
    const projectMemberColumns = getTableColumns(projectMembers);
    const assigneeColumns = getTableColumns(taskAssignees);
    const followerColumns = getTableColumns(taskFollowers);

    assert.equal(projectMemberColumns.role.notNull, true);
    assert.equal(projectMemberColumns.isOwner.notNull, true);
    assert.equal(assigneeColumns.taskId.notNull, true);
    assert.equal(assigneeColumns.isPrimary.notNull, true);
    assert.equal(assigneeColumns.unassignedAt.notNull, false);
    assert.equal(followerColumns.taskId.notNull, true);
    assert.equal(followerColumns.unfollowedAt.notNull, false);
  });
});
