import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../client.js";
import {
  sprints,
  sprintSnapshots,
  sprintAnalyticsEvents,
  organizations,
  workspaces,
  projects,
  tasks,
} from "../schema.js";
import { createSprintAnalyticsQueries } from "./sprint-analytics-queries.js";
import { AnalyticsIntegrityError } from "../errors.js";
import crypto from "crypto";

test("Sprint Analytics Queries", async (t) => {
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: orgId, name: "Org", slug: crypto.randomUUID() });
    await tx
      .insert(workspaces)
      .values({ id: workspaceId, organizationId: orgId, name: "WS", slug: crypto.randomUUID() });
  });

  const context = { organizationId: orgId, workspaceId, actorId: orgId, db };
  const queries = createSprintAnalyticsQueries(context);

  await t.test("getSprintSummary - exact start and complete", async () => {
    const sprintId = crypto.randomUUID();
    const pId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: pId, organizationId: orgId, workspaceId, name: "Proj1" });
      await tx.insert(sprints).values({
        id: sprintId,
        organizationId: orgId,
        workspaceId,
        projectId: pId,
        name: "S1",
        status: "completed",
        startedAt: new Date("2026-08-01T10:00:00Z"),
        completedAt: new Date("2026-08-14T10:00:00Z"),
      });

      await tx.insert(sprintSnapshots).values([
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          snapshotType: "start",
          dataQuality: "exact",
          capturedAt: new Date("2026-08-01T10:00:00Z"),
          scopeTaskCount: 10,
          scopeStoryPoints: 50,
          completedTaskCount: 0,
          completedStoryPoints: 0,
          remainingTaskCount: 10,
          remainingStoryPoints: 50,
        },
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          snapshotType: "complete",
          dataQuality: "exact",
          capturedAt: new Date("2026-08-14T10:00:00Z"),
          scopeTaskCount: 12,
          scopeStoryPoints: 60,
          completedTaskCount: 8,
          completedStoryPoints: 40,
          remainingTaskCount: 4,
          remainingStoryPoints: 20,
        },
      ]);
    });

    const summary = await queries.getSprintSummary(sprintId, pId);
    assert(summary !== null);
    assert.deepEqual(summary.commitment, { taskCount: 10, storyPoints: 50 });
    assert.deepEqual(summary.finalScope, { taskCount: 12, storyPoints: 60 });
    assert.deepEqual(summary.completed, { taskCount: 8, storyPoints: 40 });
    assert.deepEqual(summary.netScopeChange, { taskCount: 2, storyPoints: 10 });
    assert.equal(summary.availability.commitment, true);
    assert.equal(summary.availability.completion, true);
    assert.equal(summary.availability.timeline, true);
  });

  await t.test("getSprintSummary - missing start (legacy complete only)", async () => {
    const sprintId = crypto.randomUUID();
    const pId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: pId, organizationId: orgId, workspaceId, name: "Proj2" });
      await tx.insert(sprints).values({
        id: sprintId,
        organizationId: orgId,
        workspaceId,
        projectId: pId,
        name: "S2",
        status: "completed",
      });

      await tx.insert(sprintSnapshots).values([
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          snapshotType: "complete",
          dataQuality: "exact",
          capturedAt: new Date(),
          scopeTaskCount: 5,
          scopeStoryPoints: 20,
          completedTaskCount: 5,
          completedStoryPoints: 20,
          remainingTaskCount: 0,
          remainingStoryPoints: 0,
        },
      ]);
    });

    const summary = await queries.getSprintSummary(sprintId, pId);
    assert(summary !== null);
    assert.equal(summary.commitment, null);
    assert.equal(summary.netScopeChange, null);
    assert.deepEqual(summary.finalScope, { taskCount: 5, storyPoints: 20 });
    assert.equal(summary.availability.timeline, false);
  });

  await t.test("getVelocitySeries - filters exact only, chronological order", async () => {
    const pId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: pId, organizationId: orgId, workspaceId, name: "Proj3" });
      const createSprintWithSnap = async (name: string, dateStr: string, points: number, quality: any = "exact") => {
        const sid = crypto.randomUUID();
        await tx.insert(sprints).values({
          id: sid,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          name,
          status: "completed",
          completedAt: new Date(dateStr),
        });
        await tx.insert(sprintSnapshots).values({
          id: crypto.randomUUID(),
          sprintId: sid,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          snapshotType: "complete",
          dataQuality: quality,
          capturedAt: new Date(dateStr),
          scopeTaskCount: 5,
          scopeStoryPoints: points,
          completedTaskCount: 5,
          completedStoryPoints: points,
          remainingTaskCount: 0,
          remainingStoryPoints: 0,
        });
      };

      await createSprintWithSnap("V1", "2026-05-01T00:00:00Z", 20); // Oldest
      await createSprintWithSnap("V2", "2026-06-01T00:00:00Z", 30, "partial"); // Partial - should be excluded
      await createSprintWithSnap("V3", "2026-07-01T00:00:00Z", 40);
      await createSprintWithSnap("V4", "2026-08-01T00:00:00Z", 30); // Newest
    });

    const velocity = await queries.getVelocitySeries(pId, 2);
    // Limit 2 should get V4 and V3 (newest 2 exact), returned chronologically (V3, V4)
    assert.equal(velocity.series.length, 2);
    assert.equal(velocity.series[0].sprintName, "V3");
    assert.equal(velocity.series[1].sprintName, "V4");
    assert.equal(velocity.averageStoryPoints, 35); // (40+30)/2
  });

  await t.test("getSprintTimeline - normal reconstruction and daily bucketing", async () => {
    const sprintId = crypto.randomUUID();
    const pId = crypto.randomUUID();
    const start = new Date("2026-08-01T10:00:00Z");

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: pId, organizationId: orgId, workspaceId, name: "Proj4" });
      await tx.insert(sprints).values({
        id: sprintId,
        organizationId: orgId,
        workspaceId,
        projectId: pId,
        name: "Timeline Sprint",
        status: "active",
        startedAt: start,
      });

      await tx.insert(sprintSnapshots).values({
        id: crypto.randomUUID(),
        sprintId,
        organizationId: orgId,
        workspaceId,
        projectId: pId,
        snapshotType: "start",
        dataQuality: "exact",
        capturedAt: start,
        scopeTaskCount: 1,
        scopeStoryPoints: 5,
        completedTaskCount: 0,
        completedStoryPoints: 0,
        remainingTaskCount: 1,
        remainingStoryPoints: 5,
      });

      const t1Id = crypto.randomUUID();
      const t2Id = crypto.randomUUID();
      await tx.insert(tasks).values([
        {
          id: t1Id,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          serial: 1,
          title: "T1",
          sprintId,
          status: "todo",
          priority: "medium",
        },
        {
          id: t2Id,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          serial: 2,
          title: "T2",
          sprintId,
          status: "todo",
          priority: "medium",
        },
      ] as any);

      const evs = [
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          taskId: t1Id,
          eventType: "task_added" as const,
          occurredAt: new Date("2026-08-01T23:00:00Z"), // Near midnight
          isCompletedAtEvent: false,
          storyPointsAtEvent: 3,
        },
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          taskId: t2Id,
          eventType: "task_completed" as const,
          occurredAt: new Date("2026-08-03T10:00:00Z"),
          isCompletedAtEvent: false,
          storyPointsAtEvent: 5,
        },
      ];

      for (const e of evs) {
        await tx.insert(sprintAnalyticsEvents).values(e);
      }
    });

    const timelineUTC = (await queries.getSprintTimeline(sprintId, pId, "UTC")) as any;
    assert.equal(timelineUTC.availability.timeline, true);

    // In UTC, event is at 2026-08-01 23:00:00, so bucket is 08-01
    const utcDay1 = timelineUTC.series.find((s: any) => s.date === "2026-08-01");
    assert.equal(utcDay1?.scopeStoryPoints, 8); // 5 (initial) + 3

    // Now test with timezone Asia/Riyadh (UTC+3) -> Event shifts to 2026-08-02 02:00:00
    const timelineRiyadh = (await queries.getSprintTimeline(sprintId, pId, "Asia/Riyadh")) as any;
    assert.equal(timelineRiyadh.availability.timeline, true);

    const riyadhDay1 = timelineRiyadh.series.find((s: any) => s.date === "2026-08-01");
    const riyadhDay2 = timelineRiyadh.series.find((s: any) => s.date === "2026-08-02");

    // In Riyadh, on 08-01 it hasn't happened yet
    assert.equal(riyadhDay1?.scopeStoryPoints, 5);
    // On 08-02 it happened
    assert.equal(riyadhDay2?.scopeStoryPoints, 8);
  });

  await t.test("getSprintTimeline - complete snapshot mismatch raises error", async () => {
    const sprintId = crypto.randomUUID();
    const pId = crypto.randomUUID();
    const start = new Date("2026-08-01T10:00:00Z");
    const end = new Date("2026-08-14T10:00:00Z");

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id: pId, organizationId: orgId, workspaceId, name: "Proj5" });
      await tx.insert(sprints).values({
        id: sprintId,
        organizationId: orgId,
        workspaceId,
        projectId: pId,
        name: "Corrupt Sprint",
        status: "completed",
        startedAt: start,
        completedAt: end,
      });

      await tx.insert(sprintSnapshots).values([
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          snapshotType: "start",
          dataQuality: "exact",
          capturedAt: start,
          scopeTaskCount: 1,
          scopeStoryPoints: 5,
          completedTaskCount: 0,
          completedStoryPoints: 0,
          remainingTaskCount: 1,
          remainingStoryPoints: 5,
        },
        {
          id: crypto.randomUUID(),
          sprintId,
          organizationId: orgId,
          workspaceId,
          projectId: pId,
          snapshotType: "complete",
          dataQuality: "exact",
          capturedAt: end,
          scopeTaskCount: 999,
          scopeStoryPoints: 999,
          completedTaskCount: 0,
          completedStoryPoints: 0,
          remainingTaskCount: 999,
          remainingStoryPoints: 999,
        },
      ]);
    });

    await assert.rejects(
      queries.getSprintTimeline(sprintId, pId, "UTC"),
      (err) => err instanceof AnalyticsIntegrityError && err.message.includes("does not match Complete Snapshot"),
    );
  });
});
