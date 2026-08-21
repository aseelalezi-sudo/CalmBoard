import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  createCustomFieldsRepository,
  createProjectsRepository,
  createTasksRepository,
  customFields,
  db,
  memberships,
  organizations,
  pool,
  projects,
  projectSections,
  tasks,
  TenantConflictError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index.js";

describe("Custom Fields Domain & Integration Tests", () => {
  const orgId = "00000000-0000-0000-0000-000000000060";
  const orgBId = "00000000-0000-0000-0000-000000000061";
  const ws1Id = "00000000-0000-0000-0000-000000000062";
  const ws2Id = "00000000-0000-0000-0000-000000000063";
  const wsBId = "00000000-0000-0000-0000-000000000064";
  const userId = "00000000-0000-0000-0000-000000000065";
  let proj1Id: string;
  let proj2Id: string;

  before(async () => {
    await db.delete(tasks).where(eq(tasks.organizationId, orgId));
    await db.delete(customFields).where(eq(customFields.organizationId, orgId));
    await db.delete(projectSections).where(eq(projectSections.organizationId, orgId));
    await db.delete(projects).where(eq(projects.organizationId, orgId));

    await db
      .insert(organizations)
      .values([
        { id: orgId, name: "CF Org A", slug: "cf-org-a", createdById: null },
        { id: orgBId, name: "CF Org B", slug: "cf-org-b", createdById: null },
      ])
      .onConflictDoNothing();

    await db
      .insert(users)
      .values([{ id: userId, email: "cf-admin@example.com", name: "CF Admin" }])
      .onConflictDoNothing();

    await db
      .insert(workspaces)
      .values([
        { id: ws1Id, organizationId: orgId, name: "CF WS 1", slug: "cf-ws-1", createdById: userId },
        { id: ws2Id, organizationId: orgId, name: "CF WS 2", slug: "cf-ws-2", createdById: userId },
        { id: wsBId, organizationId: orgBId, name: "CF WS B", slug: "cf-ws-b", createdById: userId },
      ])
      .onConflictDoNothing();

    await db
      .insert(memberships)
      .values([
        {
          id: "00000000-0000-0000-0000-000000000066",
          organizationId: orgId,
          workspaceId: ws1Id,
          userId: userId,
          role: "owner",
          status: "active",
        },
      ])
      .onConflictDoNothing();

    const projRepo = createProjectsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
    const p1 = await projRepo.create({ name: "CF Project 1" });
    const p2 = await projRepo.create({ name: "CF Project 2" });
    proj1Id = p1.id;
    proj2Id = p2.id;
  });

  after(async () => {
    await pool.end();
  });

  describe("Custom Field Definition Management", () => {
    it("creates workspace-scoped and project-scoped custom fields with canonical types", async () => {
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const cfText = await cfRepo.create({
        name: "Client Name",
        key: "client_name",
        type: "short_text",
        description: "The enterprise client",
        required: true,
      });
      assert.equal(cfText.key, "client_name");
      assert.equal(cfText.type, "short_text");
      assert.equal(cfText.required, true);

      const cfNum = await cfRepo.create({
        name: "Estimated Cost",
        key: "estimated_cost",
        type: "number",
      });
      assert.equal(cfNum.key, "estimated_cost");
      assert.equal(cfNum.type, "number");

      const cfDate = await cfRepo.create({
        name: "Launch Date",
        key: "launch_date",
        type: "date",
      });
      assert.equal(cfDate.key, "launch_date");
      assert.equal(cfDate.type, "date");

      const cfSelect = await cfRepo.create({
        name: "Priority Tier",
        key: "priority_tier",
        type: "single_select",
        options: [
          { label: "Tier 1 - High", value: "tier_1", color: "#ef4444" },
          { label: "Tier 2 - Standard", value: "tier_2", color: "#3b82f6" },
        ],
      });
      assert.equal(cfSelect.key, "priority_tier");
      assert.equal(cfSelect.type, "single_select");
      assert.equal(cfSelect.options?.length, 2);

      const cfBool = await cfRepo.create({
        name: "Is Confidential",
        key: "is_confidential",
        type: "checkbox",
      });
      assert.equal(cfBool.key, "is_confidential");
      assert.equal(cfBool.type, "checkbox");

      const cfUrl = await cfRepo.create({
        name: "Documentation Link",
        key: "docs_url",
        type: "url",
      });
      assert.equal(cfUrl.key, "docs_url");
      assert.equal(cfUrl.type, "url");

      const cfProj1 = await cfRepo.create({
        name: "P1 Secret Code",
        key: "p1_secret",
        type: "short_text",
        projectId: proj1Id,
        sensitive: true,
      });
      assert.equal(cfProj1.key, "p1_secret");
      assert.equal(cfProj1.projectId, proj1Id);
      assert.equal(cfProj1.sensitive, true);
    });

    it("rejects duplicate keys within the same workspace scope", async () => {
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      await assert.rejects(
        () => cfRepo.create({ name: "Duplicate", key: "client_name", type: "short_text" }),
        TenantConflictError,
      );
    });

    it("rejects invalid select options and unsupported types", async () => {
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      await assert.rejects(
        () => cfRepo.create({ name: "Invalid Select", key: "inv_select", type: "single_select", options: [] }),
        TenantConflictError,
      );
      await assert.rejects(
        () => cfRepo.create({ name: "Invalid Type", key: "inv_type", type: "formula" }),
        TenantConflictError,
      );
    });
  });

  describe("Task Custom Field Validation on Create", () => {
    it("creates task with valid custom field values across all types", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const task = await taskRepo.create({
        projectId: proj1Id,
        title: "Task with all custom fields",
        customFields: {
          client_name: "Acme International",
          estimated_cost: 15000,
          launch_date: "2026-10-01T00:00:00.000Z",
          priority_tier: "Tier 1 - High", // should normalize to "tier_1"
          is_confidential: true,
          docs_url: "https://docs.calmboard.com/spec",
          p1_secret: "secret-code-alpha",
        },
      });

      assert.equal(task.customFields?.client_name, "Acme International");
      assert.equal(task.customFields?.estimated_cost, 15000);
      assert.equal(task.customFields?.priority_tier, "tier_1");
      assert.equal(task.customFields?.is_confidential, true);
      assert.equal(task.customFields?.docs_url, "https://docs.calmboard.com/spec");
      assert.equal(task.customFields?.p1_secret, "secret-code-alpha");
    });

    it("enforces required fields on creation", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // client_name is required: missing input should be rejected
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task missing required field",
            customFields: {
              estimated_cost: 500,
            },
          }),
        /Required custom field 'client_name' is missing/,
      );

      // Empty string for required field should be rejected
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with empty string required field",
            customFields: {
              client_name: "   ",
            },
          }),
        /Required custom field 'client_name' cannot be empty/,
      );
    });

    it("rejects unknown custom fields", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with unknown field",
            customFields: {
              client_name: "Valid Name",
              random_unregistered_key: "should fail",
            },
          }),
        /Unknown custom field 'random_unregistered_key'/,
      );
    });

    it("rejects project-scoped custom fields when used in another project", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // p1_secret belongs to proj1Id; attempting to use in proj2Id must fail
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj2Id,
            title: "Task in Proj 2 with Proj 1 field",
            customFields: {
              client_name: "Valid Name",
              p1_secret: "illegal for proj 2",
            },
          }),
        /Custom field 'p1_secret' belongs to another project/,
      );
    });

    it("rejects invalid value types on task creation", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      // Number field with string
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with invalid number",
            customFields: {
              client_name: "Valid",
              estimated_cost: "ten-thousand",
            },
          }),
        /must be a finite number/,
      );

      // Date field with invalid string
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with invalid date",
            customFields: {
              client_name: "Valid",
              launch_date: "not-a-real-date",
            },
          }),
        /must be a valid date/,
      );

      // Single select with unconfigured option
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with invalid select option",
            customFields: {
              client_name: "Valid",
              priority_tier: "tier_999_invalid",
            },
          }),
        /Invalid option for custom field 'priority_tier'/,
      );

      // Checkbox with non-boolean
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with invalid checkbox",
            customFields: {
              client_name: "Valid",
              is_confidential: "yes",
            },
          }),
        /must be a boolean/,
      );

      // URL with javascript: URI
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with invalid url",
            customFields: {
              client_name: "Valid",
              docs_url: "javascript:alert(1)",
            },
          }),
        /must be a valid HTTP or HTTPS URL/,
      );
    });
  });

  describe("Task Custom Field Updates & Merge Semantics", () => {
    it("merges custom fields on update and preserves unchanged fields", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const created = await taskRepo.create({
        projectId: proj1Id,
        title: "Initial Task",
        customFields: {
          client_name: "Alpha Corp",
          estimated_cost: 2000,
          is_confidential: false,
        },
      });

      const { task: updated } = await taskRepo.update(created.id, {
        expectedVersion: created.version,
        customFields: {
          estimated_cost: 4500,
        },
      });

      assert.equal(updated.customFields?.client_name, "Alpha Corp"); // preserved!
      assert.equal(updated.customFields?.estimated_cost, 4500); // updated!
      assert.equal(updated.customFields?.is_confidential, false); // preserved!
    });

    it("clears non-required custom fields with null", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const created = await taskRepo.create({
        projectId: proj1Id,
        title: "Clearable Task",
        customFields: {
          client_name: "Beta Corp",
          docs_url: "https://example.com/docs",
        },
      });

      const { task: updated } = await taskRepo.update(created.id, {
        expectedVersion: created.version,
        customFields: {
          docs_url: null,
        },
      });

      assert.equal(updated.customFields?.client_name, "Beta Corp");
      assert.equal(updated.customFields?.docs_url, undefined);
    });

    it("rejects clearing a required custom field on update", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const created = await taskRepo.create({
        projectId: proj1Id,
        title: "Required Field Task",
        customFields: {
          client_name: "Gamma Corp",
        },
      });

      await assert.rejects(
        () =>
          taskRepo.update(created.id, {
            expectedVersion: created.version,
            customFields: {
              client_name: null,
            },
          }),
        /Required custom field 'client_name' cannot be empty/,
      );
    });

    it("preserves exact no-op semantics when custom fields are unchanged", async () => {
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const created = await taskRepo.create({
        projectId: proj1Id,
        title: "No-Op Task",
        customFields: {
          client_name: "Delta Corp",
          estimated_cost: 100,
        },
      });

      const initialVersion = created.version;

      // Update with identical values
      const { task: updated } = await taskRepo.update(created.id, {
        expectedVersion: created.version,
        customFields: {
          client_name: "Delta Corp",
          estimated_cost: 100,
        },
      });

      assert.equal(updated.version, initialVersion);
    });
  });

  describe("Deleted Custom Field Semantics", () => {
    it("rejects using soft-deleted custom fields in new tasks or updates", async () => {
      const cfRepo = createCustomFieldsRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });
      const taskRepo = createTasksRepository({ organizationId: orgId, workspaceId: ws1Id, actorId: userId });

      const tempField = await cfRepo.create({
        name: "Temporary Field",
        key: "temp_field",
        type: "short_text",
      });

      // Soft delete the field
      await cfRepo.delete(tempField.id);

      // Creating a task using temp_field must fail as unknown
      await assert.rejects(
        () =>
          taskRepo.create({
            projectId: proj1Id,
            title: "Task with deleted field",
            customFields: {
              client_name: "Epsilon Corp",
              temp_field: "some-value",
            },
          }),
        /Unknown custom field 'temp_field'/,
      );
    });
  });
});
