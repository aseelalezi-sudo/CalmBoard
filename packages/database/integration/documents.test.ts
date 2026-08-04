import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createDocumentsRepository,
  createPublicDocumentsRepository,
  db,
  docs,
  memberships,
  organizations,
  pool,
  TenantConflictError,
  TenantPermissionDeniedError,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("document access, hierarchy, and versions", () => {
  it("enforces resource ACLs, inherited access, safe nesting, and reversible version restore", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const collaboratorId = randomUUID();

    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.test`, name: "Document owner" },
        { id: collaboratorId, email: `${collaboratorId}@example.test`, name: "Document collaborator" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Document tenant",
        slug: `document-${organizationId}`,
        ownerId,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Document workspace",
        slug: `document-${workspaceId}`,
      });
      await db.insert(memberships).values(
        [ownerId, collaboratorId].map((userId) => ({
          organizationId,
          workspaceId,
          userId,
          status: "active",
        })),
      );

      const owner = createDocumentsRepository(
        { organizationId, workspaceId, actorId: ownerId },
        { canManageWorkspaceDocuments: true },
      );
      const collaborator = createDocumentsRepository({
        organizationId,
        workspaceId,
        actorId: collaboratorId,
      });
      const root = await owner.create({
        title: "Private root",
        content: "Original content",
        workspaceAccess: "none",
        inheritPermissions: false,
      });
      const publicDocuments = createPublicDocumentsRepository();
      await assert.rejects(() => publicDocuments.get(root.id), /public document was not found/);
      await owner.update(root.id, { isPublic: true });
      assert.equal((await publicDocuments.get(root.id)).title, "Private root");
      await owner.update(root.id, { isPublic: false });
      assert.equal((await collaborator.list()).length, 0);

      await owner.setPermission(root.id, collaboratorId, "viewer");
      assert.equal((await collaborator.list())[0]?.accessLevel, "viewer");
      await assert.rejects(
        () => collaborator.update(root.id, { content: "Forbidden edit" }),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );

      await owner.setPermission(root.id, collaboratorId, "editor");
      const edited = await collaborator.update(root.id, { content: "Collaborative edit" });
      assert.equal(edited.content, "Collaborative edit");

      const child = await owner.create({
        title: "Inherited child",
        content: "Child content",
        parentId: root.id,
        workspaceAccess: "none",
        inheritPermissions: true,
      });
      const collaboratorDocuments = await collaborator.list();
      assert.equal(collaboratorDocuments.find((document) => document.id === child.id)?.accessLevel, "editor");
      await assert.rejects(
        () => owner.update(root.id, { parentId: child.id }),
        (error: unknown) => error instanceof TenantConflictError && /cycle/.test(error.message),
      );

      const firstVersion = await collaborator.saveSnapshot(root.id);
      assert.equal(firstVersion.versionNumber, 1);
      assert.equal(firstVersion.content, "Collaborative edit");
      await collaborator.update(root.id, { content: "Second revision" });
      const restored = await collaborator.restoreVersion(root.id, firstVersion.id);
      assert.equal(restored.content, "Collaborative edit");
      const versions = await collaborator.listVersions(root.id);
      assert.deepEqual(
        versions.map((version) => version.versionNumber),
        [2, 1],
      );
      assert.equal(versions[0]?.content, "Second revision");

      await owner.removePermission(root.id, collaboratorId);
      assert.equal((await collaborator.list()).length, 0);
    } finally {
      await db
        .update(docs)
        .set({ parentId: null })
        .where(eq(docs.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(docs)
        .where(eq(docs.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(memberships)
        .where(eq(memberships.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .catch(() => undefined);
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
        .where(eq(users.id, collaboratorId))
        .catch(() => undefined);
    }
  });
});
