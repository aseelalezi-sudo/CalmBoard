import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { sql } from "drizzle-orm";
import {
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  users,
  workspaces,
} from "../src/index.js";
import {
  calendarDayKey,
  taskOccursOnCalendarDay,
  visibleCalendarQueryRange,
} from "../../../apps/web/src/features/tasks/task-calendar-range.js";

after(async () => {
  await pool.end();
});

describe("task calendar range queries and pagination safety (integration)", () => {
  it("enforces interval intersection, dateless exclusion, filter parity, tenant isolation, and scale correctness", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const actorId = randomUUID();
    const assigneeAId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: "Calendar Org",
      slug: `calendar-org-${organizationId.slice(0, 8)}`,
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      organizationId,
      name: "Calendar Workspace",
      slug: `calendar-ws-${workspaceId.slice(0, 8)}`,
    });
    await db.insert(users).values([
      {
        id: actorId,
        email: `calendar-actor-${actorId.slice(0, 8)}@example.com`,
        name: "Calendar Actor",
      },
      {
        id: assigneeAId,
        email: `calendar-assignee-${assigneeAId.slice(0, 8)}@example.com`,
        name: "Calendar Assignee",
      },
    ]);
    await db.insert(memberships).values([
      {
        organizationId,
        workspaceId,
        userId: actorId,
        role: "owner",
        status: "active",
      },
      {
        organizationId,
        workspaceId,
        userId: assigneeAId,
        role: "member",
        status: "active",
      },
    ]);

    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      organizationId,
      workspaceId,
      name: "Calendar Project",
    });

    const repository = createTasksRepository({
      organizationId,
      workspaceId,
      actorId,
    });

    // ----------------------------------------------------
    // 1. Core Interval Intersection Semantics for [2026-08-01, 2026-08-31]
    // ----------------------------------------------------
    const rangeStart = new Date("2026-08-01T00:00:00.000Z");
    const rangeEnd = new Date("2026-08-31T23:59:59.999Z");

    // A. Fully inside
    const taskInside = await repository.create({
      projectId,
      title: "Task Inside Range",
      startDate: new Date("2026-08-10T09:00:00.000Z"),
      dueDate: new Date("2026-08-15T18:00:00.000Z"),
    });

    // B. Starts before range, ends inside range
    const taskStartsBefore = await repository.create({
      projectId,
      title: "Task Starts Before",
      startDate: new Date("2026-07-25T00:00:00.000Z"),
      dueDate: new Date("2026-08-05T00:00:00.000Z"),
    });

    // C. Starts inside range, ends after range
    const taskEndsAfter = await repository.create({
      projectId,
      title: "Task Ends After",
      startDate: new Date("2026-08-25T00:00:00.000Z"),
      dueDate: new Date("2026-09-05T00:00:00.000Z"),
    });

    // D. Spans across entire range (starts before, ends after)
    const taskSpansAll = await repository.create({
      projectId,
      title: "Task Spans All",
      startDate: new Date("2026-07-15T00:00:00.000Z"),
      dueDate: new Date("2026-09-15T00:00:00.000Z"),
    });

    // E. Fully outside before
    const taskOutsideBefore = await repository.create({
      projectId,
      title: "Task Outside Before",
      startDate: new Date("2026-07-01T00:00:00.000Z"),
      dueDate: new Date("2026-07-10T00:00:00.000Z"),
    });

    // F. Fully outside after
    const taskOutsideAfter = await repository.create({
      projectId,
      title: "Task Outside After",
      startDate: new Date("2026-09-10T00:00:00.000Z"),
      dueDate: new Date("2026-09-20T00:00:00.000Z"),
    });

    // G. Single-day task (due date only) inside range
    const taskDueOnlyInside = await repository.create({
      projectId,
      title: "Task Due Only Inside",
      dueDate: new Date("2026-08-12T12:00:00.000Z"),
    });

    // H. Single-day task (due date only) outside range
    const taskDueOnlyOutside = await repository.create({
      projectId,
      title: "Task Due Only Outside",
      dueDate: new Date("2026-07-12T12:00:00.000Z"),
    });

    // I. Single-day task (start date only) inside range
    const taskStartOnlyInside = await repository.create({
      projectId,
      title: "Task Start Only Inside",
      startDate: new Date("2026-08-18T12:00:00.000Z"),
    });

    // J. Single-day task (start date only) outside range
    const taskStartOnlyOutside = await repository.create({
      projectId,
      title: "Task Start Only Outside",
      startDate: new Date("2026-09-18T12:00:00.000Z"),
    });

    // K. Dateless task (startDate = null, dueDate = null)
    const taskDateless = await repository.create({
      projectId,
      title: "Task Dateless",
    });

    // L. Milestone inside range
    const taskMilestone = await repository.create({
      projectId,
      title: "Task Milestone",
      startDate: new Date("2026-08-20T12:00:00.000Z"),
      dueDate: new Date("2026-08-20T12:00:00.000Z"),
      isMilestone: true,
    });

    // Execute range query
    const rangeResults = await repository.list({
      projectId,
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
    });

    const resultIds = new Set(rangeResults.map((t) => t.id));

    // Verify included tasks
    assert.ok(resultIds.has(taskInside.id), "Task inside range must be included");
    assert.ok(resultIds.has(taskStartsBefore.id), "Task starting before and ending inside range must be included");
    assert.ok(resultIds.has(taskEndsAfter.id), "Task starting inside and ending after range must be included");
    assert.ok(resultIds.has(taskSpansAll.id), "Task spanning across entire range must be included");
    assert.ok(resultIds.has(taskDueOnlyInside.id), "Task with due date in range must be included");
    assert.ok(resultIds.has(taskStartOnlyInside.id), "Task with start date in range must be included");
    assert.ok(resultIds.has(taskMilestone.id), "Milestone task in range must be included");

    // Verify excluded tasks
    assert.ok(!resultIds.has(taskOutsideBefore.id), "Task before range must be excluded");
    assert.ok(!resultIds.has(taskOutsideAfter.id), "Task after range must be excluded");
    assert.ok(!resultIds.has(taskDueOnlyOutside.id), "Task with due date outside range must be excluded");
    assert.ok(!resultIds.has(taskStartOnlyOutside.id), "Task with start date outside range must be excluded");
    assert.ok(!resultIds.has(taskDateless.id), "Dateless task must be excluded");

    // Timezone query boundary tests:
    // Tokyo midnight boundary: 2026-08-01 00:00:00+09:00 -> 2026-07-31T15:00:00.000Z
    const taskTokyoMidnight = await repository.create({
      projectId,
      title: "Tokyo Midnight Task",
      dueDate: new Date("2026-07-31T15:00:00.000Z"),
      timezone: "Asia/Tokyo",
    });

    const tokyoBoundaryResults = await repository.list({
      projectId,
      calendarFrom: new Date("2026-07-31T15:00:00.000Z"),
      calendarTo: new Date("2026-08-31T14:59:59.999Z"),
    });
    assert.ok(
      tokyoBoundaryResults.some((t) => t.id === taskTokyoMidnight.id),
      "Task with Tokyo midnight timestamp must be returned in Tokyo-converted range query",
    );

    // ----------------------------------------------------
    // 2. Filter Parity (Additive constraints)
    // ----------------------------------------------------
    // Update taskInside to status = in_progress, priority = urgent, assignee = assigneeAId
    await repository.update(taskInside.id, {
      expectedVersion: taskInside.version,
      status: "in_progress",
      priority: "urgent",
      assigneeId: assigneeAId,
    });

    const filteredByStatus = await repository.list({
      projectId,
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
      status: "in_progress",
    });
    assert.ok(filteredByStatus.some((t) => t.id === taskInside.id));
    assert.ok(!filteredByStatus.some((t) => t.id === taskMilestone.id));

    const filteredByPriority = await repository.list({
      projectId,
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
      priority: "urgent",
    });
    assert.ok(filteredByPriority.some((t) => t.id === taskInside.id));
    assert.ok(!filteredByPriority.some((t) => t.id === taskMilestone.id));

    const filteredByAssignee = await repository.list({
      projectId,
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
      assigneeId: assigneeAId,
    });
    assert.ok(filteredByAssignee.some((t) => t.id === taskInside.id));
    assert.ok(!filteredByAssignee.some((t) => t.id === taskMilestone.id));

    const filteredBySearch = await repository.list({
      projectId,
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
      search: "Milestone",
    });
    assert.ok(filteredBySearch.some((t) => t.id === taskMilestone.id));
    assert.ok(!filteredBySearch.some((t) => t.id === taskInside.id));

    // ----------------------------------------------------
    // 3. Tenant & Workspace Isolation
    // ----------------------------------------------------
    const otherOrgId = randomUUID();
    const otherWsId = randomUUID();
    const otherActorId = randomUUID();

    await db.insert(organizations).values({
      id: otherOrgId,
      name: "Other Org",
      slug: `other-org-${otherOrgId.slice(0, 8)}`,
    });
    await db.insert(workspaces).values({
      id: otherWsId,
      organizationId: otherOrgId,
      name: "Other Workspace",
      slug: `other-ws-${otherWsId.slice(0, 8)}`,
    });
    await db.insert(users).values({
      id: otherActorId,
      email: `other-actor-${otherActorId.slice(0, 8)}@example.com`,
      name: "Other Actor",
    });
    await db.insert(memberships).values({
      organizationId: otherOrgId,
      workspaceId: otherWsId,
      userId: otherActorId,
      role: "owner",
      status: "active",
    });

    const otherProjectId = randomUUID();
    await db.insert(projects).values({
      id: otherProjectId,
      organizationId: otherOrgId,
      workspaceId: otherWsId,
      name: "Other Project",
    });

    const otherRepo = createTasksRepository({
      organizationId: otherOrgId,
      workspaceId: otherWsId,
      actorId: otherActorId,
    });

    const foreignTask = await otherRepo.create({
      projectId: otherProjectId,
      title: "Foreign Task in Range",
      dueDate: new Date("2026-08-15T12:00:00.000Z"),
    });

    const isolationResults = await repository.list({
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
    });
    assert.ok(!isolationResults.some((t) => t.id === foreignTask.id), "Cross-tenant task must not be returned");

    // ----------------------------------------------------
    // 4. Large Dataset (>200 tasks) Scale & Pagination-Safe Query
    // ----------------------------------------------------
    const scaleProject = randomUUID();
    await db.insert(projects).values({
      id: scaleProject,
      organizationId,
      workspaceId,
      name: "Scale Project",
    });

    // Create 220 historical tasks in 2025
    await db.execute(sql`
      insert into tasks (
        id,
        organization_id,
        workspace_id,
        project_id,
        serial,
        title,
        status,
        priority,
        "order",
        due_date,
        created_at,
        updated_at
      )
      select
        gen_random_uuid(),
        ${organizationId},
        ${workspaceId},
        ${scaleProject},
        'HIST-' || gs::text,
        'Historical task ' || gs::text,
        'todo',
        'medium',
        gs,
        '2025-01-15 12:00:00+00'::timestamptz,
        now(),
        now()
      from generate_series(1, 220) as gs
    `);

    // Create 3 target tasks in August 2026
    const target1 = await repository.create({
      projectId: scaleProject,
      title: "Target Task August 1",
      dueDate: new Date("2026-08-05T12:00:00.000Z"),
    });
    const target2 = await repository.create({
      projectId: scaleProject,
      title: "Target Task August 2",
      startDate: new Date("2026-08-10T09:00:00.000Z"),
      dueDate: new Date("2026-08-12T18:00:00.000Z"),
    });
    const target3 = await repository.create({
      projectId: scaleProject,
      title: "Target Task August 3",
      dueDate: new Date("2026-08-25T12:00:00.000Z"),
    });

    // Query for August 2026 range on scaleProject
    const calendarQueryResults = await repository.list({
      projectId: scaleProject,
      calendarFrom: rangeStart,
      calendarTo: rangeEnd,
    });

    // Assert only the 3 target tasks are returned, without loading the 210 historical tasks
    assert.equal(calendarQueryResults.length, 3, "Range query must return exactly 3 tasks in the visible month");
    const calendarIds = new Set(calendarQueryResults.map((t) => t.id));
    assert.ok(calendarIds.has(target1.id));
    assert.ok(calendarIds.has(target2.id));
    assert.ok(calendarIds.has(target3.id));
  });

  it("guarantees task timezone and calendar query envelope compatibility across Asia/Tokyo, Asia/Riyadh, America/New_York, and UTC", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const actorId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: "TZ Org",
      slug: `tz-org-${organizationId.slice(0, 8)}`,
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      organizationId,
      name: "TZ Workspace",
      slug: `tz-ws-${workspaceId.slice(0, 8)}`,
    });
    await db.insert(users).values({
      id: actorId,
      email: `tz-actor-${actorId.slice(0, 8)}@example.com`,
      name: "TZ Actor",
    });
    await db.insert(memberships).values({
      organizationId,
      workspaceId,
      userId: actorId,
      role: "owner",
      status: "active",
    });

    const projectId = randomUUID();
    await db.insert(projects).values({
      id: projectId,
      organizationId,
      workspaceId,
      name: "TZ Project",
    });

    const repository = createTasksRepository({
      organizationId,
      workspaceId,
      actorId,
    });

    // 1. Task in Asia/Tokyo at midnight local time:
    // 2026-08-01 00:00:00+09:00 -> 2026-07-31T15:00:00.000Z
    const tokyoMidnightTask = await repository.create({
      projectId,
      title: "Tokyo Midnight Task",
      startDate: new Date("2026-07-31T15:00:00.000Z"),
      dueDate: new Date("2026-07-31T15:00:00.000Z"),
      timezone: "Asia/Tokyo",
    });

    // 2. Task in Asia/Riyadh at midnight local time:
    // 2026-08-01 00:00:00+03:00 -> 2026-07-31T21:00:00.000Z
    const riyadhMidnightTask = await repository.create({
      projectId,
      title: "Riyadh Midnight Task",
      startDate: new Date("2026-07-31T21:00:00.000Z"),
      dueDate: new Date("2026-07-31T21:00:00.000Z"),
      timezone: "Asia/Riyadh",
    });

    // 3. Task in America/New_York late night local time:
    // 2026-08-01 23:30:00-04:00 (EDT) -> 2026-08-02T03:30:00.000Z
    const nyLateNightTask = await repository.create({
      projectId,
      title: "New York Late Night Task",
      startDate: new Date("2026-08-02T03:30:00.000Z"),
      dueDate: new Date("2026-08-02T03:30:00.000Z"),
      timezone: "America/New_York",
    });

    // 4. Task in UTC at midnight:
    // 2026-08-01 00:00:00Z
    const utcMidnightTask = await repository.create({
      projectId,
      title: "UTC Midnight Task",
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      dueDate: new Date("2026-08-01T00:00:00.000Z"),
      timezone: "UTC",
    });

    // 5. Multi-day task in Tokyo:
    // 2026-08-01 to 2026-08-05 in Tokyo -> 2026-07-31T15:00:00.000Z to 2026-08-05T14:59:59.000Z
    const tokyoMultiDayTask = await repository.create({
      projectId,
      title: "Tokyo Multi-Day Task",
      startDate: new Date("2026-07-31T15:00:00.000Z"),
      dueDate: new Date("2026-08-05T14:59:59.000Z"),
      timezone: "Asia/Tokyo",
    });

    // 6. Task outside visible range (Tokyo on August 15):
    const tokyoOutsideTask = await repository.create({
      projectId,
      title: "Tokyo Outside Task",
      startDate: new Date("2026-08-14T15:00:00.000Z"),
      dueDate: new Date("2026-08-14T15:00:00.000Z"),
      timezone: "Asia/Tokyo",
    });

    // 7. Task before visible range (Tokyo on July 20):
    const tokyoBeforeTask = await repository.create({
      projectId,
      title: "Tokyo Before Task",
      startDate: new Date("2026-07-19T15:00:00.000Z"),
      dueDate: new Date("2026-07-19T15:00:00.000Z"),
      timezone: "Asia/Tokyo",
    });

    // ----------------------------------------------------
    // Scenario A: User views Single Day (August 1, 2026)
    // ----------------------------------------------------
    const dayAnchor = new Date(2026, 7, 1);
    const dayQueryRange = visibleCalendarQueryRange(dayAnchor, "day", 0, "UTC");

    const dayResults = await repository.list({
      projectId,
      calendarFrom: new Date(dayQueryRange.calendarFrom),
      calendarTo: new Date(dayQueryRange.calendarTo),
    });

    const dayResultIds = new Set(dayResults.map((t) => t.id));

    // Zero false negatives: all tasks intended for August 1 in their respective timezones MUST be returned
    assert.ok(dayResultIds.has(tokyoMidnightTask.id), "Tokyo midnight task must be returned for August 1");
    assert.ok(dayResultIds.has(riyadhMidnightTask.id), "Riyadh midnight task must be returned for August 1");
    assert.ok(dayResultIds.has(nyLateNightTask.id), "New York late night task must be returned for August 1");
    assert.ok(dayResultIds.has(utcMidnightTask.id), "UTC midnight task must be returned for August 1");
    assert.ok(dayResultIds.has(tokyoMultiDayTask.id), "Tokyo multi-day task must be returned for August 1");

    // Correct bounds: tasks outside August 1 envelope must NOT be returned
    assert.ok(!dayResultIds.has(tokyoOutsideTask.id), "August 15 task must not be returned for August 1");
    assert.ok(!dayResultIds.has(tokyoBeforeTask.id), "July 20 task must not be returned for August 1");

    // Frontend placement verification:
    // Each returned task must be placed onto August 1 cell by taskOccursOnCalendarDay
    assert.equal(taskOccursOnCalendarDay(tokyoMidnightTask, dayAnchor), true);
    assert.equal(taskOccursOnCalendarDay(riyadhMidnightTask, dayAnchor), true);
    assert.equal(taskOccursOnCalendarDay(nyLateNightTask, dayAnchor), true);
    assert.equal(taskOccursOnCalendarDay(utcMidnightTask, dayAnchor), true);
    assert.equal(taskOccursOnCalendarDay(tokyoMultiDayTask, dayAnchor), true);

    // ----------------------------------------------------
    // Scenario B: User views Month View (August 2026 month grid)
    // ----------------------------------------------------
    const monthAnchor = new Date(2026, 7, 1);
    const monthQueryRange = visibleCalendarQueryRange(monthAnchor, "month", 0, "UTC");

    const monthResults = await repository.list({
      projectId,
      calendarFrom: new Date(monthQueryRange.calendarFrom),
      calendarTo: new Date(monthQueryRange.calendarTo),
    });

    const monthResultIds = new Set(monthResults.map((t) => t.id));

    assert.ok(monthResultIds.has(tokyoMidnightTask.id));
    assert.ok(monthResultIds.has(riyadhMidnightTask.id));
    assert.ok(monthResultIds.has(nyLateNightTask.id));
    assert.ok(monthResultIds.has(utcMidnightTask.id));
    assert.ok(monthResultIds.has(tokyoMultiDayTask.id));
    assert.ok(monthResultIds.has(tokyoOutsideTask.id), "August 15 task must be included in August month grid");
    assert.ok(!monthResultIds.has(tokyoBeforeTask.id), "July 20 task must not be included in August month grid");
  });
});
