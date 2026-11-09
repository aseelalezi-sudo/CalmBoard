import { expect, test } from "@playwright/test";
import {
  attachments,
  db,
  memberships,
  membershipPermissionOverrides,
  permissions,
  projectMembers,
} from "@calmboard/database";
import { eq, inArray } from "drizzle-orm";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

test("planning aggregates, timesheet review and attachment IDs recheck private access", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const owner = await fixture(await registerIsolatedOwner(page));
  const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const query = new URLSearchParams(scope).toString();
  const startedAt = "2026-01-07T12:00:00.000Z";
  const taskIds: string[] = [];
  const projectIds: string[] = [];
  for (const privacy of ["workspace", "private"]) {
    const project = await api(page, "/projects", "POST", { ...scope, name: `Planning ${privacy}`, privacy });
    expect(project.status, JSON.stringify(project.data)).toBe(201);
    const projectId = (project.data as { id: string }).id;
    projectIds.push(projectId);
    const task = await api(page, "/tasks", "POST", { ...scope, projectId, title: `Planning task ${privacy}` });
    expect(task.status, JSON.stringify(task.data)).toBe(201);
    taskIds.push((task.data as { id: string }).id);
  }
  const objective = await api(page, "/goals", "POST", { ...scope, type: "objective", title: "Private aggregate" });
  expect(objective.status, JSON.stringify(objective.data)).toBe(201);
  const objectiveId = (objective.data as { id: string }).id;
  const result = await api(page, "/goals", "POST", {
    ...scope,
    type: "key_result",
    parentId: objectiveId,
    title: "Private result",
  });
  expect(result.status, JSON.stringify(result.data)).toBe(201);
  const resultId = (result.data as { id: string }).id;
  const linked = await api(page, `/goals/${resultId}/tasks`, "POST", { ...scope, taskId: taskIds[1] });
  expect(linked.status, JSON.stringify(linked.data)).toBe(201);
  const publicGoal = await api(page, "/goals", "POST", { ...scope, type: "objective", title: "Public aggregate" });
  expect(publicGoal.status).toBe(201);
  const publicGoalId = (publicGoal.data as { id: string }).id;
  const seededAttachments = await db
    .insert(attachments)
    .values([
      {
        ...scope,
        taskId: taskIds[1],
        uploaderId: owner.userId,
        fileName: "task-private.txt",
        fileSize: 1,
        url: "https://files.example.test/task",
        scanStatus: "failed",
      },
      {
        ...scope,
        projectId: projectIds[1],
        uploaderId: owner.userId,
        fileName: "project-private.txt",
        fileSize: 1,
        url: "https://files.example.test/project",
        scanStatus: "failed",
      },
      {
        ...scope,
        taskId: taskIds[0],
        uploaderId: owner.userId,
        fileName: "public.txt",
        fileSize: 1,
        url: "https://files.example.test/public",
        scanStatus: "failed",
      },
    ])
    .returning({ id: attachments.id });
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const memberPage = await context.newPage();
    const member = await fixture(await registerIsolatedOwner(memberPage));
    const [membership] = await db
      .insert(memberships)
      .values({ ...scope, userId: member.userId, role: "member", status: "active" })
      .returning();
    const grants = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, ["goals.manage", "time_logs.manage", "timesheets.review", "attachments.manage"]));
    expect(grants).toHaveLength(4);
    await db.insert(membershipPermissionOverrides).values(
      grants.map((permission) => ({
        ...scope,
        membershipId: membership.id,
        permissionId: permission.id,
        scope: "workspace" as const,
        effect: "allow" as const,
        createdBy: owner.userId,
      })),
    );
    expect(
      (await api(memberPage, "/time-logs", "POST", { ...scope, taskId: taskIds[1], durationMinutes: 90 })).status,
    ).toBe(403);
    const publicLog = await api(memberPage, "/time-logs", "POST", {
      ...scope,
      taskId: taskIds[0],
      durationMinutes: 10,
      startedAt,
    });
    expect(publicLog.status, JSON.stringify(publicLog.data)).toBe(201);
    const [assignment] = await db
      .insert(projectMembers)
      .values({ ...scope, projectId: projectIds[1], userId: member.userId })
      .returning();
    const privateLog = await api(memberPage, "/time-logs", "POST", {
      ...scope,
      taskId: taskIds[1],
      durationMinutes: 90,
      startedAt,
    });
    expect(privateLog.status, JSON.stringify(privateLog.data)).toBe(201);
    const before = await api(memberPage, `/time-logs?${query}`);
    expect(before.status).toBe(200);
    type Sheet = { id: string; version: number; totalMinutes: number };
    const ownSheet = (before.data as { timesheets: Sheet[] }).timesheets[0]!;
    expect(ownSheet.totalMinutes).toBe(100);
    const submit = await api(memberPage, `/timesheets/${ownSheet.id}/submit`, "POST", {
      ...scope,
      expectedVersion: ownSheet.version,
    });
    expect(submit.status, JSON.stringify(submit.data)).toBe(201);
    const submitted = submit.data as Sheet;
    const ownerLog = await api(page, "/time-logs", "POST", {
      ...scope,
      taskId: taskIds[1],
      durationMinutes: 20,
      startedAt,
    });
    expect(ownerLog.status).toBe(201);
    const ownerData = await api(page, `/time-logs?${query}`);
    const ownerSheet = (ownerData.data as { timesheets: Sheet[] }).timesheets[0]!;
    const ownerSubmit = await api(page, `/timesheets/${ownerSheet.id}/submit`, "POST", {
      ...scope,
      expectedVersion: ownerSheet.version,
    });
    expect(ownerSubmit.status).toBe(201);
    const reviewVersion = (ownerSubmit.data as Sheet).version;
    const grantedGoals = await api(memberPage, `/goals?${query}`);
    expect(grantedGoals.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: resultId, linkedTasks: [expect.objectContaining({ id: taskIds[1] })] }),
      ]),
    );
    await db.update(projectMembers).set({ deletedAt: new Date() }).where(eq(projectMembers.id, assignment.id));
    const after = await api(memberPage, `/time-logs?${query}`);
    expect(after.status).toBe(200);
    expect(after.data).toMatchObject({ totalMinutes: 10, timesheets: [], reviewQueue: [] });
    expect(JSON.stringify(after.data)).not.toContain(taskIds[1]);
    expect(
      (
        await api(memberPage, `/timesheets/${submitted.id}/submit`, "POST", {
          ...scope,
          expectedVersion: submitted.version,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api(memberPage, `/timesheets/${ownerSheet.id}/review`, "POST", {
          ...scope,
          expectedVersion: reviewVersion,
          decision: "approved",
        })
      ).status,
    ).toBe(404);
    const hiddenGoals = await api(memberPage, `/goals?${query}`);
    expect(hiddenGoals.status).toBe(200);
    expect(hiddenGoals.data).toEqual([expect.objectContaining({ id: publicGoalId })]);
    expect((await api(memberPage, "/goals", "PATCH", { ...scope, id: objectiveId, title: "Overwrite" })).status).toBe(
      404,
    );
    expect((await api(memberPage, `/goals/${resultId}/checkins`, "POST", { ...scope, note: "Guess" })).status).toBe(
      404,
    );
    for (const attachment of seededAttachments.slice(0, 2)) {
      expect(
        (
          await api(memberPage, "/attachments/complete", "POST", {
            ...scope,
            id: attachment.id,
            projectId: projectIds[0],
          })
        ).status,
      ).toBe(404);
      expect((await api(memberPage, `/attachments?${query}&id=${attachment.id}`, "DELETE")).status).toBe(404);
      expect((await api(page, "/attachments/complete", "POST", { ...scope, id: attachment.id })).status).toBe(201);
    }
    expect(
      (await api(memberPage, "/attachments/complete", "POST", { ...scope, id: seededAttachments[2]!.id })).status,
    ).toBe(201);
    const reviewed = await api(page, `/timesheets/${submitted.id}/review`, "POST", {
      ...scope,
      expectedVersion: submitted.version,
      decision: "approved",
    });
    expect(reviewed.status, JSON.stringify(reviewed.data)).toBe(201);
    expect(reviewed.data).toMatchObject({ totalMinutes: 100, status: "approved" });
    await db.update(projectMembers).set({ deletedAt: null }).where(eq(projectMembers.id, assignment.id));
    expect(
      (await api(memberPage, "/attachments/complete", "POST", { ...scope, id: seededAttachments[0]!.id })).status,
    ).toBe(201);
    expect((await api(memberPage, `/attachments?${query}&id=${seededAttachments[1]!.id}`, "DELETE")).status).toBe(200);
  } finally {
    await context.close();
  }
});
