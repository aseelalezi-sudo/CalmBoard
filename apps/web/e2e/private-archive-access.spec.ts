import { expect, test } from "@playwright/test";
import {
  automationRuns,
  automations,
  db,
  exportJobs,
  memberships,
  membershipPermissionOverrides,
  permissions,
  projectTeams,
  teams,
} from "@calmboard/database";
import { and, eq, inArray } from "drizzle-orm";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

test("document scope, archive grants and deleted teams protect private content over HTTP", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await fixture(await registerIsolatedOwner(page));
  const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const query = new URLSearchParams(scope).toString();
  const projects: string[] = [];
  for (const privacy of ["workspace", "private"]) {
    const project = await api(page, "/projects", "POST", { ...scope, name: `Archive ${privacy}`, privacy });
    expect(project.status, JSON.stringify(project.data)).toBe(201);
    projects.push((project.data as { id: string }).id);
  }
  const task = await api(page, "/tasks", "POST", { ...scope, projectId: projects[1], title: "Team restricted" });
  expect(task.status).toBe(201);
  const taskId = (task.data as { id: string }).id;
  async function privateDocument(title: string, options: { projectId?: string; parentId?: string } = {}) {
    const document = await api(page, "/docs", "POST", { ...scope, ...options, title, content: `${title} content` });
    expect(document.status, JSON.stringify(document.data)).toBe(201);
    const id = (document.data as { id: string }).id;
    const secured = await api(page, "/docs", "PATCH", { ...scope, id, workspaceAccess: "none" });
    expect(secured.status).toBe(200);
    return id;
  }
  const rootId = await privateDocument("Standalone private root");
  const childId = await privateDocument("Inherited private child", { parentId: rootId });
  const projectDocumentId = await privateDocument("Scoped project document", { projectId: projects[0] });
  const saved = await api(page, `/docs/${childId}/versions`, "POST", { ...scope, action: "save_snapshot" });
  expect(saved.status, JSON.stringify(saved.data)).toBe(201);
  const [rule] = await db
    .insert(automations)
    .values({ ...scope, name: "Private execution", trigger: "task_created", runs: 1 })
    .returning();
  await db
    .insert(automationRuns)
    .values({ ...scope, automationId: rule.id, taskId, status: "success", message: "Private execution details" });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const memberPage = await context.newPage();
    const member = await fixture(await registerIsolatedOwner(memberPage));
    const [team] = await db
      .insert(teams)
      .values({ ...scope, name: "Project access team" })
      .returning();
    const [membership] = await db
      .insert(memberships)
      .values({ ...scope, userId: member.userId, role: "member", status: "active", teamId: team.id })
      .returning();
    await db.insert(projectTeams).values({ ...scope, projectId: projects[1], teamId: team.id });
    const permissionRows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, ["data.export", "documents.manage"]));
    expect(permissionRows).toHaveLength(2);
    for (const permission of permissionRows) {
      await db.insert(membershipPermissionOverrides).values({
        ...scope,
        membershipId: membership.id,
        permissionId: permission.id,
        scope: "workspace",
        effect: permission.key === "documents.manage" ? "deny" : "allow",
        createdBy: owner.userId,
      });
    }
    await db.insert(membershipPermissionOverrides).values({
      ...scope,
      projectId: projects[0],
      membershipId: membership.id,
      permissionId: permissionRows.find((permission) => permission.key === "documents.manage")!.id,
      scope: "project",
      effect: "allow",
      createdBy: owner.userId,
    });
    const scopedQuery = `${query}&projectId=${projects[0]}`;
    const listed = await api(memberPage, `/docs?${scopedQuery}`);
    expect(listed.status, JSON.stringify(listed.data)).toBe(200);
    expect(listed.data).toEqual([expect.objectContaining({ id: projectDocumentId, accessLevel: "manager" })]);
    const blockedUpdate = await api(memberPage, "/docs", "PATCH", {
      ...scope,
      projectId: projects[0],
      id: rootId,
      content: "Overwrite",
    });
    expect(blockedUpdate.status, JSON.stringify(blockedUpdate.data)).toBe(403);
    expect((await api(memberPage, `/docs/${rootId}/permissions?${scopedQuery}`)).status).toBe(403);
    expect((await api(memberPage, `/docs/${childId}/versions?${scopedQuery}`)).status).toBe(403);
    expect(
      (
        await api(memberPage, "/docs", "PATCH", {
          ...scope,
          projectId: projects[0],
          id: projectDocumentId,
          content: "Allowed within project",
        })
      ).status,
    ).toBe(200);
    for (const format of ["json", "pdf", "xlsx"]) {
      expect((await api(memberPage, "/workspaces/export", "POST", { ...scope, format })).status).toBe(403);
    }
    expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(200);
    await db.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, team.id));
    expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(403);
    const history = await api(memberPage, `/automations?${query}`);
    expect(history.status).toBe(200);
    expect(history.data).toMatchObject({ automations: [], runs: [] });
    await db.update(teams).set({ deletedAt: null }).where(eq(teams.id, team.id));
    expect((await api(memberPage, `/tasks/${taskId}?${query}`)).status).toBe(200);
    const restoredHistory = await api(memberPage, `/automations?${query}`);
    expect(restoredHistory.data).toMatchObject({ automations: [expect.objectContaining({ id: rule.id, runs: 1 })] });
    const granted = await api(page, `/docs/${rootId}/permissions`, "POST", {
      ...scope,
      targetUserId: member.userId,
      accessLevel: "manager",
    });
    expect(granted.status, JSON.stringify(granted.data)).toBe(201);
    const requested = await api(memberPage, "/workspaces/export", "POST", { ...scope, format: "pdf" });
    expect(requested.status, JSON.stringify(requested.data)).toBe(201);
    const jobId = (requested.data as { id: string }).id;
    await db
      .update(exportJobs)
      .set({
        status: "completed",
        objectKey: "fixture/report.pdf",
        fileName: "report.pdf",
        contentType: "application/pdf",
        fileSize: 1,
        checksumSha256: "a".repeat(64),
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .where(eq(exportJobs.id, jobId));
    const revoked = await api(page, `/docs/${rootId}/permissions?${query}&targetUserId=${member.userId}`, "DELETE");
    expect(revoked.status, JSON.stringify(revoked.data)).toBe(200);
    expect((await api(memberPage, `/workspaces/export/${jobId}/download?${query}`)).status).toBe(403);
    const deniedChildId = await privateDocument("Project deny inheritance", {
      projectId: projects[0],
      parentId: rootId,
    });
    const documentPermissionId = permissionRows.find((permission) => permission.key === "documents.manage")!.id;
    await db
      .update(membershipPermissionOverrides)
      .set({ effect: "allow" })
      .where(
        and(
          eq(membershipPermissionOverrides.membershipId, membership.id),
          eq(membershipPermissionOverrides.permissionId, documentPermissionId),
          eq(membershipPermissionOverrides.scope, "workspace"),
        ),
      );
    await db
      .update(membershipPermissionOverrides)
      .set({ effect: "deny" })
      .where(
        and(
          eq(membershipPermissionOverrides.membershipId, membership.id),
          eq(membershipPermissionOverrides.permissionId, documentPermissionId),
          eq(membershipPermissionOverrides.projectId, projects[0]!),
        ),
      );
    const denied = await api(memberPage, `/docs?${scopedQuery}`);
    expect(denied.status).toBe(200);
    expect(denied.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: rootId }), expect.objectContaining({ id: childId })]),
    );
    expect(
      (denied.data as { id: string }[]).some(
        (document) => document.id === projectDocumentId || document.id === deniedChildId,
      ),
    ).toBe(false);
    expect(
      (
        await api(memberPage, "/docs", "PATCH", {
          ...scope,
          projectId: projects[0],
          id: projectDocumentId,
          content: "Denied by project scope",
        })
      ).status,
    ).toBe(403);
    expect((await api(memberPage, "/workspaces/export", "POST", { ...scope, format: "json" })).status).toBe(403);
    expect(
      (
        await api(page, `/docs/${projectDocumentId}/permissions`, "POST", {
          ...scope,
          targetUserId: member.userId,
          accessLevel: "manager",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await api(memberPage, "/docs", "PATCH", {
          ...scope,
          projectId: projects[0],
          id: projectDocumentId,
          content: "Allowed by explicit document grant",
        })
      ).status,
    ).toBe(200);
  } finally {
    await context.close();
  }
});
