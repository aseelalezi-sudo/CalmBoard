import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, memberships, projectMembers } from "@calmboard/database";
import { eq } from "drizzle-orm";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

for (const privacy of ["private", "private-members"] as const) {
  test(`${privacy}: exclude unassigned members before pagination and enforce access after assignment removal`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    const owner = await fixture(await registerIsolatedOwner(page));
    const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
    const query = new URLSearchParams(scope).toString();
    const created = await api(page, "/projects", "POST", { ...scope, name: `Private ${randomUUID()}`, privacy });
    expect(created.status).toBe(201);
    const projectId = (created.data as { id: string }).id;
    const task = await api(page, "/tasks", "POST", { ...scope, projectId, title: `Hidden ${randomUUID()}` });
    expect(task.status).toBe(201);
    const taskId = (task.data as { id: string }).id;
    const version = (task.data as { version: number }).version;
    const publicProject = await api(page, "/projects", "POST", { ...scope, name: `Public ${randomUUID()}` });
    expect(publicProject.status).toBe(201);
    const publicProjectId = (publicProject.data as { id: string }).id;
    const publicTask = await api(page, "/tasks", "POST", {
      ...scope,
      projectId: publicProjectId,
      title: "Visible task",
    });
    expect(publicTask.status).toBe(201);
    const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const memberPage = await context.newPage();
      const member = await fixture(await registerIsolatedOwner(memberPage));
      const [membership] = await db
        .insert(memberships)
        .values({ ...scope, userId: member.userId, role: "member", status: "active" })
        .returning();
      const projects = await api(memberPage, `/projects?${query}`);
      expect(projects.status).toBe(200);
      expect(projects.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: publicProjectId })]));
      expect(projects.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: projectId })]));
      const tasks = await api(memberPage, `/tasks?${query}`);
      expect(tasks.status).toBe(200);
      expect(tasks.data).toEqual([expect.objectContaining({ id: (publicTask.data as { id: string }).id })]);
      const paginated = await api(memberPage, `/tasks?${query}&limit=1`);
      expect(paginated.status).toBe(200);
      expect(paginated.data).toMatchObject({
        items: [expect.objectContaining({ id: (publicTask.data as { id: string }).id })],
        total: 1,
      });
      expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(403);
      expect((await api(memberPage, `/comments?${query}&taskId=${taskId}`)).status).toBe(403);
      expect(
        (await api(memberPage, `/tasks/${taskId}`, "PATCH", { ...scope, title: "Forbidden", expectedVersion: version }))
          .status,
      ).toBe(403);
      expect((await api(memberPage, "/tasks", "POST", { ...scope, projectId, title: "Forbidden" })).status).toBe(403);
      expect(
        (
          await api(memberPage, "/tasks/import", "POST", {
            ...scope,
            tasks: [{ projectId, title: "Forbidden import" }],
          })
        ).status,
      ).toBe(404);
      expect((await api(memberPage, `/tasks/${taskId}?${query}&projectId=${publicProjectId}`)).status).toBe(403);
      const [assignment] = await db
        .insert(projectMembers)
        .values({ ...scope, projectId, userId: member.userId })
        .returning();
      expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(200);
      const updated = await api(memberPage, `/tasks/${taskId}`, "PATCH", {
        ...scope,
        title: "Assigned member edit",
        expectedVersion: version,
      });
      expect(updated.status, JSON.stringify(updated.data)).toBe(200);
      await db.update(projectMembers).set({ deletedAt: new Date() }).where(eq(projectMembers.id, assignment.id));
      expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(403);
      // Existing private-view grants remain effective for administrators.
      await db.update(memberships).set({ role: "admin" }).where(eq(memberships.id, membership.id));
      expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(200);
      const ownerRead = await api(page, `/tasks/${taskId}?${query}`);
      expect(ownerRead.status).toBe(200);
      expect(ownerRead.data).toMatchObject({ task: { title: "Assigned member edit" } });
    } finally {
      await context.close();
    }
  });
}
