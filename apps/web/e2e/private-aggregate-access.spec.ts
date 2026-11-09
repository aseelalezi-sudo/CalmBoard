import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import {
  attachments,
  db,
  docs,
  exportJobs,
  memberships,
  permissions,
  membershipPermissionOverrides,
  projectMembers,
} from "@calmboard/database";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

test("search, project analytics and full-export downloads respect private-project access", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const owner = await fixture(await registerIsolatedOwner(page));
  const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const query = new URLSearchParams(scope).toString();
  const marker = `PrivacyNeedle${randomUUID().replaceAll("-", "")}`;
  const projectIds: string[] = [],
    taskIds: string[] = [];
  for (const privacy of ["workspace", "private"]) {
    const project = await api(page, "/projects", "POST", { ...scope, name: marker, privacy });
    expect(project.status).toBe(201);
    const projectId = (project.data as { id: string }).id;
    projectIds.push(projectId);
    const task = await api(page, "/tasks", "POST", { ...scope, projectId, title: marker });
    expect(task.status).toBe(201);
    const taskId = (task.data as { id: string }).id;
    taskIds.push(taskId);
    expect(
      (await api(page, "/comments", "POST", { ...scope, taskId, userId: owner.userId, content: marker })).status,
    ).toBe(201);
    await db.insert(docs).values({
      ...scope,
      projectId,
      authorId: owner.userId,
      title: marker,
      content: marker,
      workspaceAccess: "viewer",
    });
    await db.insert(attachments).values([
      {
        ...scope,
        taskId,
        uploaderId: owner.userId,
        fileName: `${marker}.txt`,
        fileSize: 1,
        url: "s3://test/task-fixture",
      },
      {
        ...scope,
        projectId,
        uploaderId: owner.userId,
        fileName: `${marker}.txt`,
        fileSize: 1,
        url: "s3://test/project-fixture",
      },
    ]);
  }
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const memberPage = await context.newPage();
    const member = await fixture(await registerIsolatedOwner(memberPage));
    const [membership] = await db
      .insert(memberships)
      .values({ ...scope, userId: member.userId, role: "member", status: "active" })
      .returning();
    const search = await api(memberPage, `/search?${query}&q=${marker}`);
    expect(search.status).toBe(200);
    expect(search.data).toMatchObject({
      projects: [expect.objectContaining({ id: projectIds[0] })],
      tasks: [expect.objectContaining({ id: taskIds[0] })],
      comments: [expect.objectContaining({ taskId: taskIds[0] })],
      docs: [expect.objectContaining({ projectId: projectIds[0] })],
    });
    const found = (search.data as { attachments: Array<{ taskId: string | null; projectId: string | null }> })
      .attachments;
    expect(found).toHaveLength(2);
    expect(found.every((a) => a.taskId === taskIds[0] || a.projectId === projectIds[0])).toBe(true);
    expect((await api(memberPage, `/api/projects/${projectIds[1]}/sprint-analytics/overview?${query}`)).status).toBe(
      403,
    );
    expect((await api(memberPage, `/api/projects/${projectIds[0]}/sprint-analytics/overview?${query}`)).status).toBe(
      200,
    );
    const [permission] = await db.select().from(permissions).where(eq(permissions.key, "data.export"));
    await db.insert(membershipPermissionOverrides).values({
      ...scope,
      membershipId: membership.id,
      permissionId: permission.id,
      scope: "workspace",
      effect: "allow",
      createdBy: owner.userId,
    });
    expect((await api(memberPage, "/workspaces/export", "POST", { ...scope, format: "pdf" })).status).toBe(403);
    const organizationExport = await api(page, `/organizations/${owner.organizationId}/export`, "POST", {});
    expect(organizationExport.status, JSON.stringify(organizationExport.data)).toBe(201);
    const [assignment] = await db
      .insert(projectMembers)
      .values({ ...scope, projectId: projectIds[1], userId: member.userId })
      .returning();
    const requested = await api(memberPage, "/workspaces/export", "POST", { ...scope, format: "pdf" });
    expect(requested.status, JSON.stringify(requested.data)).toBe(201);
    const jobId = (requested.data as { id: string }).id;
    await db
      .update(exportJobs)
      .set({
        status: "completed",
        fileSize: 1,
        checksumSha256: "a".repeat(64),
        completedAt: new Date(),
        objectKey: "test/private-report.pdf",
        fileName: "report.pdf",
        contentType: "application/pdf",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .where(and(eq(exportJobs.id, jobId), eq(exportJobs.requestedBy, member.userId)));
    await db.update(projectMembers).set({ deletedAt: new Date() }).where(eq(projectMembers.id, assignment.id));
    // Must fail before object storage is called, even though data.export remains granted.
    expect((await api(memberPage, `/workspaces/export/${jobId}/download?${query}`)).status).toBe(403);
  } finally {
    await context.close();
  }
});
