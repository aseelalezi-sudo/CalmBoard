import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { taskApprovalRequests, taskApprovalReviewers, taskChecklistItems, taskChecklists } from "./schema.js";

describe("task workflows schema", () => {
  it("keeps checklist and approval records directly tenant scoped", () => {
    for (const table of [taskChecklists, taskChecklistItems, taskApprovalRequests, taskApprovalReviewers]) {
      const columns = getTableColumns(table);
      assert.equal(columns.organizationId.notNull, true);
      assert.equal(columns.workspaceId.notNull, true);
      assert.equal(columns.projectId.notNull, true);
      assert.equal(columns.taskId.notNull, true);
      assert.equal(columns.deletedAt.notNull, false);
    }
  });

  it("stores checklist completion and multi-reviewer decisions", () => {
    const itemColumns = getTableColumns(taskChecklistItems);
    const requestColumns = getTableColumns(taskApprovalRequests);
    const reviewerColumns = getTableColumns(taskApprovalReviewers);

    assert.equal(itemColumns.checklistId.notNull, true);
    assert.equal(itemColumns.isCompleted.notNull, true);
    assert.equal(requestColumns.requestedBy.notNull, true);
    assert.equal(requestColumns.mode.notNull, true);
    assert.equal(requestColumns.status.notNull, true);
    assert.equal(reviewerColumns.reviewerId.notNull, true);
    assert.equal(reviewerColumns.sequence.notNull, true);
    assert.equal(reviewerColumns.status.notNull, true);
  });
});
