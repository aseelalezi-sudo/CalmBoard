import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import {
  activities,
  attachments,
  automationRuns,
  automations,
  branches,
  comments,
  customFields,
  dashboardLayouts,
  documentPermissions,
  docs,
  docVersions,
  formResponses,
  forms,
  goalCheckins,
  goalTaskLinks,
  goals,
  memberships,
  notifications,
  organizations,
  projectSections,
  projectWipLimits,
  projects,
  savedViews,
  tasks,
  teams,
  timeLogs,
  timesheets,
  workspaces,
} from "./schema.js";

const workspaceOwnedTables = {
  activities,
  attachments,
  automationRuns,
  automations,
  comments,
  customFields,
  dashboardLayouts,
  documentPermissions,
  docs,
  docVersions,
  formResponses,
  forms,
  goalCheckins,
  goalTaskLinks,
  goals,
  notifications,
  projectSections,
  projectWipLimits,
  projects,
  savedViews,
  tasks,
  teams,
  timeLogs,
  timesheets,
};

describe("tenant-owned schema", () => {
  it("keeps direct non-null tenant columns on every workspace-owned table", () => {
    for (const [tableName, table] of Object.entries(workspaceOwnedTables)) {
      const columns = getTableColumns(table);
      assert.ok(columns.organizationId, `${tableName} must have organizationId`);
      assert.ok(columns.workspaceId, `${tableName} must have workspaceId`);
      assert.equal(columns.organizationId.notNull, true, `${tableName}.organizationId must be NOT NULL`);
      assert.equal(columns.workspaceId.notNull, true, `${tableName}.workspaceId must be NOT NULL`);
    }
  });

  it("keeps organization membership mandatory while allowing organization-wide membership", () => {
    const columns = getTableColumns(memberships);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, false);
  });

  it("keeps audit and soft-delete columns on deletable user content", () => {
    const auditedTables = {
      attachments,
      automations,
      branches,
      comments,
      customFields,
      docs,
      forms,
      goals,
      organizations,
      projectSections,
      projects,
      savedViews,
      tasks,
      teams,
      workspaces,
    };
    for (const [tableName, table] of Object.entries(auditedTables)) {
      const columns = getTableColumns(table);
      assert.ok(columns.createdAt, `${tableName} must have createdAt`);
      assert.ok(columns.updatedAt, `${tableName} must have updatedAt`);
      assert.ok(columns.deletedAt, `${tableName} must have deletedAt`);
      assert.equal(columns.createdAt.notNull, true);
      assert.equal(columns.updatedAt.notNull, true);
      assert.equal(columns.deletedAt.notNull, false);
    }
  });
});
