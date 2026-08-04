import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  createWorkloadRepository,
  db,
  memberships,
  organizations,
  pool,
  users,
  workloadCapacities,
  workspaces,
} from "../src/index";

after(async () => pool.end());

describe("tenant-scoped workload capacity and time off", () => {
  it("persists capacity, member leave, and workspace holidays for active members", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const userId = randomUUID();
    try {
      await db.insert(users).values({ id: userId, email: `${userId}@example.com`, name: "Capacity member" });
      await db
        .insert(organizations)
        .values({ id: organizationId, ownerId: userId, name: "Capacity org", slug: `capacity-${organizationId}` });
      await db
        .insert(workspaces)
        .values({ id: workspaceId, organizationId, name: "Capacity workspace", slug: `capacity-${workspaceId}` });
      await db.insert(memberships).values({ userId, organizationId, workspaceId: null, role: "owner" });

      const repository = createWorkloadRepository({ organizationId, workspaceId, actorId: userId });
      const capacity = await repository.upsertCapacity({ userId, weeklyMinutes: 2100, workdayMask: 62 });
      assert.equal(capacity.weeklyMinutes, 2100);
      await repository.createTimeOff({
        userId,
        kind: "vacation",
        startsOn: "2026-07-27",
        endsOn: "2026-07-28",
      });
      await repository.createTimeOff({
        kind: "public_holiday",
        startsOn: "2026-07-30",
        endsOn: "2026-07-30",
        note: "Workspace holiday",
      });

      const loaded = await repository.list("2026-07-27", "2026-08-02");
      assert.equal(loaded.capacities.length, 1);
      assert.equal(loaded.timeOff.length, 2);
      assert.deepEqual(loaded.timeOff.map((entry) => entry.kind).sort(), ["public_holiday", "vacation"]);

      await assert.rejects(
        () =>
          db.insert(workloadCapacities).values({
            organizationId,
            workspaceId,
            userId: randomUUID(),
            weeklyMinutes: 2400,
            workdayMask: 62,
          }),
        (error: unknown) => (error as { cause?: { code?: string } }).cause?.code === "23503",
      );
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, userId))
        .catch(() => undefined);
    }
  });
});
