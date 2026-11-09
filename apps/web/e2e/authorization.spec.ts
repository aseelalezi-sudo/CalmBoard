import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, memberships } from "@calmboard/database";
import { registerIsolatedOwner } from "./auth";

import { api, fixture } from "./api";

for (const role of ["owner", "admin", "member", "viewer"] as const) {
  test(`${role}: task permissions, tenant isolation and session-owned comments`, async ({ page, browser }) => {
    test.setTimeout(120_000);
    const owner = await fixture(await registerIsolatedOwner(page));
    const scope = { organizationId: owner.organizationId, workspaceId: owner.workspaceId };
    const query = new URLSearchParams(scope).toString();
    const project = await api(page, "/projects", "POST", { ...scope, name: `Authorization ${randomUUID()}` });
    expect(project.status, JSON.stringify(project.data)).toBe(201);
    const projectId = (project.data as { id: string }).id;
    const title = `Protected task ${randomUUID()}`;
    const created = await api(page, "/tasks", "POST", { ...scope, projectId, title });
    expect(created.status, JSON.stringify(created.data)).toBe(201);
    const taskId = (created.data as { id: string }).id;

    // A separate browser context prevents either identity borrowing cookies.
    const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const otherPage = await otherContext.newPage();
      const other = await fixture(await registerIsolatedOwner(otherPage));
      const foreignScope = { organizationId: other.organizationId, workspaceId: other.workspaceId };
      const foreignQuery = new URLSearchParams(foreignScope).toString();
      const forbidden = await api(otherPage, `/tasks?${query}&actorId=${owner.userId}`);
      expect(forbidden.status).toBe(403);
      expect(forbidden.data).toMatchObject({ error: "The authenticated user is not a member of this tenant" });
      // A valid own-tenant scope must not make a foreign resource visible.
      expect((await api(otherPage, `/tasks/${taskId}?${foreignQuery}`)).status).toBe(404);

      let actorPage = page;
      let actorId = owner.userId;
      if (role !== "owner") {
        await db.insert(memberships).values({ ...scope, userId: other.userId, role, status: "active" });
        actorPage = otherPage;
        actorId = other.userId;
      }
      const readable = await api(actorPage, `/tasks?${query}&projectId=${projectId}`);
      expect(readable.status).toBe(200);
      expect(readable.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: taskId, title })]));

      const changedTitle = `${title} updated`;
      const updated = await api(actorPage, `/tasks/${taskId}`, "PATCH", {
        ...scope,
        actorId: owner.userId,
        expectedVersion: (created.data as { version: number }).version,
        title: changedTitle,
      });
      if (role === "viewer") {
        expect(updated.status).toBe(403);
        expect(updated.data).toMatchObject({ error: "Permission 'tasks.update' is required" });
        const denied = await api(actorPage, "/comments", "POST", {
          ...scope,
          taskId,
          userId: owner.userId,
          content: "Viewer must not write",
        });
        expect(denied.status).toBe(403);
        expect(denied.data).toMatchObject({ error: "Permission 'comments.manage' is required" });
      } else {
        expect(updated.status, JSON.stringify(updated.data)).toBe(200);
        // A forged author is replaced with the authenticated session identity.
        const comment = await api(actorPage, "/comments", "POST", {
          ...scope,
          taskId,
          actorId: other.userId === actorId ? owner.userId : other.userId,
          userId: other.userId === actorId ? owner.userId : other.userId,
          content: `Session author ${role}`,
        });
        expect(comment.status, JSON.stringify(comment.data)).toBe(201);
        expect(comment.data).toMatchObject({ userId: actorId, content: `Session author ${role}` });
        const commentId = (comment.data as { id: string }).id;
        const reaction = await api(actorPage, "/comments/reactions", "POST", {
          ...scope,
          id: commentId,
          emoji: "👍",
          active: true,
          actorId: other.userId === actorId ? owner.userId : other.userId,
        });
        expect(reaction.status, JSON.stringify(reaction.data)).toBe(200);
        expect(reaction.data).toMatchObject({ reactionUserIds: { "👍": [actorId] } });
      }
      // Read back through the owner to verify persistence, including no write
      // after a denied request. A status code alone is insufficient evidence.
      const persisted = await api(page, `/tasks?${query}&projectId=${projectId}`);
      expect(persisted.status).toBe(200);
      expect(persisted.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: taskId, title: role === "viewer" ? title : changedTitle }),
        ]),
      );
      const comments = await api(page, `/comments?${query}&taskId=${taskId}`);
      expect(comments.status).toBe(200);
      if (role === "viewer") expect(comments.data).toEqual([]);
      else expect(comments.data).toEqual(expect.arrayContaining([expect.objectContaining({ userId: actorId })]));
    } finally {
      await otherContext.close();
    }
  });
}
