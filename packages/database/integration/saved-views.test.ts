import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createSavedViewsRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("owner-scoped saved views", () => {
  it("persists table state, protects private views, and keeps one default", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.com`, name: "View owner" },
        { id: memberId, email: `${memberId}@example.com`, name: "View member" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Saved views org",
        slug: `saved-views-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Saved views workspace",
        slug: `saved-views-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, workspaceId: null, role: "owner" },
        { userId: memberId, organizationId, workspaceId: null, role: "member" },
      ]);
      await db.insert(projects).values({ id: projectId, organizationId, workspaceId, name: "Saved views" });

      const owner = createSavedViewsRepository({ organizationId, workspaceId, actorId: ownerId });
      const member = createSavedViewsRepository({ organizationId, workspaceId, actorId: memberId });
      const first = await owner.create({
        projectId,
        name: "Private table",
        viewType: "table",
        filters: { priority: "high" },
        configuration: { schemaVersion: 1, table: { columnSizing: { title: 380 } } },
        isShared: false,
        isDefault: true,
      });
      const second = await owner.create({
        projectId,
        name: "Shared board",
        viewType: "board",
        filters: { status: "todo" },
        configuration: { schemaVersion: 1 },
        isShared: true,
        isDefault: true,
      });

      const ownerViews = await owner.list(projectId);
      assert.equal(ownerViews.length, 2);
      assert.equal(ownerViews.find((view) => view.id === first.id)?.isDefault, false);
      assert.equal(ownerViews.find((view) => view.id === second.id)?.isDefault, true);
      const memberViews = await member.list(projectId);
      assert.deepEqual(
        memberViews.map((view) => view.id),
        [second.id],
      );
      await assert.rejects(() => member.delete(second.id), /saved view was not found/);

      const updated = await owner.update(first.id, "table", {
        configuration: { schemaVersion: 1, table: { columnSizing: { title: 460 } } },
      });
      assert.equal(
        (updated.configuration as { table?: { columnSizing?: { title?: number } } }).table?.columnSizing?.title,
        460,
      );
      await assert.rejects(() => owner.update(first.id, "board", { name: "Wrong type" }), /type does not match/);
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, ownerId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, memberId))
        .catch(() => undefined);
    }
  });
});
