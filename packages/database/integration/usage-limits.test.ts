import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import {
  attachments,
  db,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  usageLimitErrorFromDatabase,
  usageLimits,
  users,
  workspaces,
} from "../src/index";

after(async () => {
  await pool.end();
});

function usageLimitRejection(resource: "seats" | "projects" | "tasks" | "storage", limit: number) {
  return (error: unknown) => {
    const mapped = usageLimitErrorFromDatabase(error);
    return mapped?.resource === resource && mapped.limit === limit && mapped.current > mapped.limit;
  };
}

describe("server-enforced organization usage limits", () => {
  it("rejects seat, project, task, and storage overages including concurrent writes", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const userIds = [randomUUID(), randomUUID(), randomUUID()];

    try {
      await db.insert(users).values(
        userIds.map((id, index) => ({
          id,
          name: `Usage member ${index + 1}`,
          email: `usage-${id}@example.test`,
          passwordHash: "integration-test-hash",
        })),
      );
      await db.insert(organizations).values({
        id: organizationId,
        name: "Usage limits tenant",
        slug: `usage-${organizationId}`,
        ownerId: userIds[0],
        plan: "team",
        seats: 2,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Usage limits workspace",
        slug: `usage-${workspaceId}`,
      });
      await db
        .update(usageLimits)
        .set({ maxSeats: 2, maxProjects: 1, maxTasks: 2, maxStorageMb: 1 })
        .where(eq(usageLimits.organizationId, organizationId));

      await db.insert(memberships).values([
        { userId: userIds[0]!, organizationId, role: "owner", status: "active" },
        { userId: userIds[0]!, organizationId, workspaceId, role: "owner", status: "active" },
        { userId: userIds[1]!, organizationId, workspaceId, role: "member", status: "active" },
      ]);
      await assert.rejects(
        () =>
          db.insert(memberships).values({
            userId: userIds[2]!,
            organizationId,
            workspaceId,
            role: "member",
            status: "active",
          }),
        usageLimitRejection("seats", 2),
      );

      const projectAttempts = await Promise.allSettled(
        ["Concurrent project A", "Concurrent project B"].map((name) =>
          db.insert(projects).values({ organizationId, workspaceId, name }).returning({ id: projects.id }),
        ),
      );
      assert.equal(projectAttempts.filter((result) => result.status === "fulfilled").length, 1);
      const projectFailure = projectAttempts.find((result) => result.status === "rejected");
      assert.equal(
        projectFailure?.status === "rejected"
          ? usageLimitErrorFromDatabase(projectFailure.reason)?.resource
          : undefined,
        "projects",
      );
      const projectResult = projectAttempts.find((result) => result.status === "fulfilled");
      const projectId = projectResult?.status === "fulfilled" ? projectResult.value[0]?.id : undefined;
      assert.ok(projectId);

      await db.insert(tasks).values([
        { organizationId, workspaceId, projectId, serial: "USAGE-1", title: "Usage task 1" },
        { organizationId, workspaceId, projectId, serial: "USAGE-2", title: "Usage task 2" },
      ]);
      await assert.rejects(
        () =>
          db.insert(tasks).values({
            organizationId,
            workspaceId,
            projectId,
            serial: "USAGE-3",
            title: "Usage task 3",
          }),
        usageLimitRejection("tasks", 2),
      );

      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.projectId, projectId)))
        .limit(1);
      assert.ok(task);
      await db.insert(attachments).values({
        organizationId,
        workspaceId,
        taskId: task.id,
        uploaderId: userIds[0]!,
        fileName: "first.bin",
        fileSize: 700_000,
        mimeType: "application/octet-stream",
        url: `usage/${organizationId}/first.bin`,
      });
      await assert.rejects(
        () =>
          db.insert(attachments).values({
            organizationId,
            workspaceId,
            taskId: task.id,
            uploaderId: userIds[0]!,
            fileName: "over-limit.bin",
            fileSize: 400_000,
            mimeType: "application/octet-stream",
            url: `usage/${organizationId}/over-limit.bin`,
          }),
        usageLimitRejection("storage", 1_048_576),
      );

      const [counters] = await db.select().from(usageLimits).where(eq(usageLimits.organizationId, organizationId));
      assert.equal(counters.currentSeats, 2);
      assert.equal(counters.currentProjects, 1);
      assert.equal(counters.currentTasks, 2);
      assert.equal(counters.currentStorageBytes, 700_000);
    } finally {
      await db
        .delete(attachments)
        .where(eq(attachments.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(projects)
        .where(eq(projects.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userIds[0]!))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userIds[1]!))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userIds[2]!))
        .catch(() => undefined);
    }
  });
});
