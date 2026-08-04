import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  createPublicFormsRepository,
  db,
  formResponses,
  forms,
  organizations,
  pool,
  projects,
  tasks,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

describe("public form response and deferred task creation", () => {
  it("keeps the response tenant scoped and durably queues task creation", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const formId = randomUUID();
    try {
      await db.insert(organizations).values({
        id: organizationId,
        name: "Form tenant",
        slug: `form-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Form workspace",
        slug: `form-${workspaceId}`,
      });
      await db.insert(projects).values({
        id: projectId,
        organizationId,
        workspaceId,
        name: "Form project",
      });
      await db.insert(forms).values({
        id: formId,
        organizationId,
        workspaceId,
        projectId,
        name: "Request form",
        fields: [
          { id: "subject", type: "text", label: "Subject", required: true },
          { id: "details", type: "textarea", label: "Details" },
        ],
        settings: {
          schemaVersion: 1,
          createTask: true,
          status: "todo",
          priority: "high",
          captchaEnabled: true,
          taskTitleFieldId: "subject",
          taskDescriptionFieldId: "details",
        },
      });

      const result = await createPublicFormsRepository().submit(formId, {
        subject: "Customer request",
        details: "Submitted through the public form",
      });
      assert.ok(result.responseId);
      assert.equal(result.taskCreationStatus, "pending");

      const [response] = await db
        .select()
        .from(formResponses)
        .where(
          and(
            eq(formResponses.organizationId, organizationId),
            eq(formResponses.workspaceId, workspaceId),
            eq(formResponses.formId, formId),
          ),
        );
      assert.deepEqual(response?.data, {
        subject: "Customer request",
        details: "Submitted through the public form",
      });
      assert.equal(response?.id, result.responseId);
      assert.equal(response?.createdTaskId, null);
      assert.equal(response?.taskCreationStatus, "pending");
      assert.equal(response?.taskCreationAttempts, 0);
      assert.deepEqual(response?.taskCreationPayload, {
        projectId,
        title: "[Request form] Customer request",
        description: "Submitted through the public form",
        status: "todo",
        priority: "high",
      });

      const queuedTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.organizationId, organizationId));
      assert.equal(queuedTasks.length, 0);
    } finally {
      await db.delete(formResponses).where(eq(formResponses.organizationId, organizationId));
      await db.delete(tasks).where(eq(tasks.organizationId, organizationId));
      await db.delete(forms).where(eq(forms.organizationId, organizationId));
      await db.delete(projects).where(eq(projects.organizationId, organizationId));
      await db.delete(workspaces).where(eq(workspaces.organizationId, organizationId));
      await db.delete(organizations).where(eq(organizations.id, organizationId));
    }
  });
});
