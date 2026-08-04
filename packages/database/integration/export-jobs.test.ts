import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  createExportJobsRepository,
  db,
  exportJobs,
  memberships,
  organizations,
  pool,
  TenantConflictError,
  TenantResourceNotFoundError,
  users,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("workspace export job formats", () => {
  it("persists the selected format and binds idempotency to requester and format", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const idempotencyKey = `export-format/${randomUUID()}`;
    try {
      await db.insert(users).values([
        { id: ownerId, email: `${ownerId}@example.com`, name: "Export owner" },
        { id: memberId, email: `${memberId}@example.com`, name: "Export member" },
      ]);
      await db.insert(organizations).values({
        id: organizationId,
        ownerId,
        name: "Export format org",
        slug: `export-format-${organizationId}`,
      });
      await db.insert(workspaces).values({
        id: workspaceId,
        organizationId,
        name: "Export format workspace",
        slug: `export-format-${workspaceId}`,
      });
      await db.insert(memberships).values([
        { userId: ownerId, organizationId, workspaceId: null, role: "owner" },
        { userId: memberId, organizationId, workspaceId, role: "member" },
      ]);

      const owner = createExportJobsRepository({ organizationId, workspaceId, actorId: ownerId });
      const member = createExportJobsRepository({ organizationId, workspaceId, actorId: memberId });
      const created = await owner.request(idempotencyKey, "pdf");
      assert.equal(created.format, "pdf");
      assert.equal((await owner.request(idempotencyKey, "pdf")).id, created.id);
      await assert.rejects(() => owner.request(idempotencyKey, "xlsx"), TenantConflictError);
      await assert.rejects(() => member.request(idempotencyKey, "pdf"), TenantResourceNotFoundError);
    } finally {
      await db
        .delete(exportJobs)
        .where(eq(exportJobs.organizationId, organizationId))
        .catch(() => undefined);
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(inArray(users.id, [ownerId, memberId]))
        .catch(() => undefined);
    }
  });
});
