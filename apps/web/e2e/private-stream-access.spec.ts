import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import {
  db,
  memberships,
  projectMembers,
  notifications,
  activities,
  membershipPermissionOverrides,
  permissions,
} from "@calmboard/database";
import { eq } from "drizzle-orm";
import { registerIsolatedOwner } from "./auth";
import { api, fixture } from "./api";

type Change = { scope: { projectId?: string; taskId?: string }; id: string };
type Joined = { ok: boolean; presence?: Array<{ id: string }> };
const origin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

async function socketFor(page: Page) {
  const cookies = await page.context().cookies(origin);
  const socket = io(`${origin}/realtime`, {
    extraHeaders: { Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    autoConnect: false,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
    socket.connect();
  });
  return socket;
}

function join(socket: Socket, scope: { organizationId: string; workspaceId: string }): Promise<Joined> {
  return socket.timeout(15_000).emitWithAck("realtime:join", scope);
}

test("streams and live sockets recheck private access and revoked sessions without reconnecting", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await fixture(await registerIsolatedOwner(page));
  const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
  const query = new URLSearchParams(scope).toString();
  const tasks: Array<{ id: string; version: number; projectId: string }> = [];
  for (const privacy of ["workspace", "private"]) {
    const project = await api(page, "/projects", "POST", { ...scope, name: `Stream ${randomUUID()}`, privacy });
    expect(project.status).toBe(201);
    const projectId = (project.data as { id: string }).id;
    const task = await api(page, "/tasks", "POST", { ...scope, projectId, title: `Stream task ${privacy}` });
    expect(task.status).toBe(201);
    tasks.push(task.data as { id: string; version: number; projectId: string });
  }
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const sockets: Socket[] = [];
  try {
    const memberPage = await context.newPage();
    const member = await fixture(await registerIsolatedOwner(memberPage));
    const [membership] = await db
      .insert(memberships)
      .values({ ...scope, userId: member.userId, role: "member", status: "active" })
      .returning();
    const [audit] = await db.select().from(permissions).where(eq(permissions.key, "audit.view"));
    await db.insert(membershipPermissionOverrides).values({
      ...scope,
      membershipId: membership.id,
      permissionId: audit.id,
      scope: "workspace",
      effect: "allow",
      createdBy: owner.userId,
    });
    for (const task of tasks) {
      await db.insert(notifications).values({
        ...scope,
        userId: member.userId,
        type: "task_update",
        title: `Notification ${task.projectId}`,
        entityType: "task",
        entityId: task.id,
      });
      await db
        .insert(activities)
        .values({ ...scope, actorId: owner.userId, action: "task.updated", entityType: "task", entityId: task.id });
    }
    const notices = await api(memberPage, `/notifications?${query}`);
    expect(notices.status).toBe(200);
    expect(notices.data).toEqual([expect.objectContaining({ entityId: tasks[0].id })]);
    const history = await api(memberPage, `/activities?${query}&limit=100`);
    expect(history.status).toBe(200);
    expect((history.data as Array<{ entityId: string }>).some((item) => item.entityId === tasks[1].id)).toBe(false);
    expect((history.data as Array<{ entityId: string }>).some((item) => item.entityId === tasks[0].id)).toBe(true);
    const ownerSocket = await socketFor(page);
    sockets.push(ownerSocket);
    const memberSocket = await socketFor(memberPage);
    sockets.push(memberSocket);
    expect((await join(ownerSocket, scope)).ok).toBe(true);
    expect((await join(memberSocket, scope)).ok).toBe(true);
    const ownerEvents: Change[] = [],
      memberEvents: Change[] = [];
    ownerSocket.on("realtime:event", (event: Change) => ownerEvents.push(event));
    memberSocket.on("realtime:event", (event: Change) => memberEvents.push(event));
    const mutate = async (index: number) => {
      const task = tasks[index];
      const response = await api(page, `/tasks/${task.id}`, "PATCH", {
        ...scope,
        title: `Change ${randomUUID()}`,
        expectedVersion: task.version,
      });
      expect(response.status, JSON.stringify(response.data)).toBe(200);
      task.version++;
    };
    const newlyPrivate = await api(page, "/projects", "POST", {
      ...scope,
      name: `Private creation ${randomUUID()}`,
      privacy: "private",
    });
    expect(newlyPrivate.status).toBe(201);
    const newProjectId = (newlyPrivate.data as { id: string }).id;
    await mutate(1);
    await mutate(0);
    // The public event is an ordered delivery barrier for the same socket.
    await expect.poll(() => memberEvents.some((event) => event.scope.taskId === tasks[0].id)).toBe(true);
    await expect.poll(() => ownerEvents.some((event) => event.scope.projectId === newProjectId)).toBe(true);
    expect(
      memberEvents.some((event) => event.scope.taskId === tasks[1].id || event.scope.projectId === newProjectId),
    ).toBe(false);
    const [assignment] = await db
      .insert(projectMembers)
      .values({ ...scope, projectId: tasks[1].projectId, userId: member.userId })
      .returning();
    await mutate(1);
    await expect.poll(() => memberEvents.filter((event) => event.scope.taskId === tasks[1].id).length).toBe(1);
    await db.update(projectMembers).set({ deletedAt: new Date() }).where(eq(projectMembers.id, assignment.id));
    await mutate(1);
    await mutate(0);
    await expect.poll(() => memberEvents.filter((event) => event.scope.taskId === tasks[0].id).length).toBe(2);
    expect(memberEvents.filter((event) => event.scope.taskId === tasks[1].id)).toHaveLength(1);
    const logout = await api(memberPage, "/auth/logout", "POST", {});
    expect(logout.status).toBe(201);
    await mutate(0);
    // Join revalidation supplies a server acknowledgement after the mutation;
    // no arbitrary sleep is used to assert absence of an unauthorized event.
    expect((await join(memberSocket, scope)).ok).toBe(false);
    expect(memberEvents.filter((event) => event.scope.taskId === tasks[0].id)).toHaveLength(2);
    const presence = await join(ownerSocket, scope);
    expect(presence.ok).toBe(true);
    expect(presence.presence?.some((user) => user.id === member.userId)).toBe(false);
  } finally {
    for (const socket of sockets) socket.disconnect();
    await context.close();
  }
});
