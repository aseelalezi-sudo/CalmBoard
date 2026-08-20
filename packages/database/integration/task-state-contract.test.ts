import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import {
  createTasksRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  users,
  workspaces,
} from "../src/index.js";

after(async () => {
  await pool.end();
});

describe("task state domain contract (integration)", () => {
  it("enforces canonical state invariants, transitions, dates, milestones, and no-ops across production paths", async () => {
    const organizationId = randomUUID();
    const workspaceId = randomUUID();
    const actorId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      name: "State Org",
      slug: `state-org-${organizationId.slice(0, 8)}`,
    });
    await db.insert(workspaces).values({
      id: workspaceId,
      organizationId,
      name: "State Workspace",
      slug: `state-ws-${workspaceId.slice(0, 8)}`,
    });
    await db.insert(users).values({
      id: actorId,
      email: `actor-${actorId.slice(0, 8)}@example.com`,
      name: "State Actor",
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
      name: "State Project",
      key: `SP${projectId.slice(0, 4)}`.toUpperCase(),
    });

    const repository = createTasksRepository({
      organizationId,
      workspaceId,
      actorId,
    });

    // 1. Creation Invariants
    // A. status = "done" forces progress = 100
    const doneTask = await repository.create({
      projectId,
      title: "Done on create",
      status: "done",
      progress: 30, // should be normalized to 100
    });
    assert.equal(doneTask.status, "done");
    assert.equal(doneTask.progress, 100);

    // B. progress = 100 preserves non-done status (does not implicitly transition to done)
    const inProgress100 = await repository.create({
      projectId,
      title: "In progress with 100% progress",
      status: "in_progress",
      progress: 100,
    });
    assert.equal(inProgress100.status, "in_progress");
    assert.equal(inProgress100.progress, 100);

    // C. Canceled status preserves progress
    const canceledTask = await repository.create({
      projectId,
      title: "Canceled with progress",
      status: "canceled",
      progress: 45,
    });
    assert.equal(canceledTask.status, "canceled");
    assert.equal(canceledTask.progress, 45);

    // D. Valid milestone with identical dates
    const milestoneDate = new Date("2026-09-01T10:00:00Z");
    const milestoneTask = await repository.create({
      projectId,
      title: "Launch Milestone",
      isMilestone: true,
      startDate: milestoneDate,
      dueDate: milestoneDate,
    });
    assert.equal(milestoneTask.isMilestone, true);
    assert.equal(new Date(milestoneTask.startDate!).getTime(), milestoneDate.getTime());
    assert.equal(new Date(milestoneTask.dueDate!).getTime(), milestoneDate.getTime());

    // E. Rejections on create
    // Invalid status
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid status",
          status: "finished" as never,
        }),
      (err: unknown) => err instanceof TenantConflictError && /status is invalid/.test(err.message),
    );

    // Invalid progress (> 100)
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid progress",
          progress: 150,
        }),
      (err: unknown) => err instanceof TenantConflictError && /progress must be an integer/.test(err.message),
    );

    // Invalid date range (startDate > dueDate)
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid dates",
          startDate: new Date("2026-09-05T10:00:00Z"),
          dueDate: new Date("2026-09-01T10:00:00Z"),
        }),
      (err: unknown) => err instanceof TenantConflictError && /startDate cannot be after dueDate/.test(err.message),
    );

    // Invalid milestone (differing dates)
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid milestone",
          isMilestone: true,
          startDate: new Date("2026-09-01T10:00:00Z"),
          dueDate: new Date("2026-09-02T10:00:00Z"),
        }),
      (err: unknown) =>
        err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
    );

    // Invalid recurrence (isRecurring false with recurrence)
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid recurrence",
          isRecurring: false,
          recurrence: { frequency: "weekly" },
        }),
      (err: unknown) =>
        err instanceof TenantConflictError &&
        /isRecurring cannot be false when recurrence is provided/.test(err.message),
    );

    // Invalid task timezone rejected at repository layer
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid timezone task",
          timezone: "Invalid/Timezone",
        }),
      (err: unknown) =>
        err instanceof TenantConflictError && /Task timezone must be a valid IANA timezone/.test(err.message),
    );

    // Invalid recurrence timezone rejected at repository layer
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Invalid recurrence timezone",
          recurrence: {
            frequency: "weekly",
            timezone: "Atlantis/Poseidon",
          },
        }),
      (err: unknown) =>
        err instanceof TenantConflictError &&
        /Task recurrence timezone must be a valid IANA timezone/.test(err.message),
    );

    // Duplicate recurrence weekdays rejected at repository layer
    await assert.rejects(
      async () =>
        repository.create({
          projectId,
          title: "Duplicate weekdays recurrence",
          recurrence: {
            frequency: "weekly",
            weekdays: [1, 2, 1],
          },
        }),
      (err: unknown) =>
        err instanceof TenantConflictError && /weekdays cannot contain duplicate days/.test(err.message),
    );

    // Valid recurrence with paused status and IANA timezone
    const pausedRecurrenceTask = await repository.create({
      projectId,
      title: "Paused Recurrence Task",
      recurrence: {
        frequency: "weekly",
        weekdays: [0, 2, 4],
        timezone: "Asia/Riyadh",
        status: "paused",
      },
    });
    assert.equal(pausedRecurrenceTask.isRecurring, true);
    assert.equal(pausedRecurrenceTask.recurrence?.status, "paused");
    assert.equal(pausedRecurrenceTask.recurrence?.timezone, "Asia/Riyadh");
    assert.deepEqual(pausedRecurrenceTask.recurrence?.weekdays, [0, 2, 4]);

    // 2. Update Invariants & State Transitions
    // A. Transitioning to done sets progress = 100
    const normalTask = await repository.create({
      projectId,
      title: "Normal Task",
      status: "todo",
      progress: 25,
      startDate: new Date("2026-09-01T10:00:00Z"),
      dueDate: new Date("2026-09-05T10:00:00Z"),
    });
    const updateToDone = await repository.update(normalTask.id, {
      expectedVersion: normalTask.version,
      status: "done",
    });
    assert.equal(updateToDone.task.status, "done");
    assert.equal(updateToDone.task.progress, 100);

    // B. Setting progress = 100 on non-done task keeps status
    const inProgressTask = await repository.create({
      projectId,
      title: "In Progress Task",
      status: "in_progress",
      progress: 60,
    });
    const updateProgress100 = await repository.update(inProgressTask.id, {
      expectedVersion: inProgressTask.version,
      progress: 100,
    });
    assert.equal(updateProgress100.task.status, "in_progress");
    assert.equal(updateProgress100.task.progress, 100);

    // C. Transitioning to canceled preserves previous progress
    const updateToCanceled = await repository.update(inProgressTask.id, {
      expectedVersion: updateProgress100.task.version,
      status: "canceled",
    });
    assert.equal(updateToCanceled.task.status, "canceled");
    assert.equal(updateToCanceled.task.progress, 100);

    // Reopening canceled task preserves progress
    const reopenTask = await repository.update(inProgressTask.id, {
      expectedVersion: updateToCanceled.task.version,
      status: "in_progress",
    });
    assert.equal(reopenTask.task.status, "in_progress");
    assert.equal(reopenTask.task.progress, 100);

    // D. Milestone update rules
    // Attempt to extend dueDate on milestone without setting isMilestone: false -> rejected
    await assert.rejects(
      async () =>
        repository.update(milestoneTask.id, {
          expectedVersion: milestoneTask.version,
          dueDate: new Date("2026-09-08T10:00:00Z"),
        }),
      (err: unknown) =>
        err instanceof TenantConflictError && /milestone requires identical startDate and dueDate/.test(err.message),
    );

    // Converting milestone to normal task by explicitly setting isMilestone: false
    const convertMilestone = await repository.update(milestoneTask.id, {
      expectedVersion: milestoneTask.version,
      isMilestone: false,
      dueDate: new Date("2026-09-08T10:00:00Z"),
    });
    assert.equal(convertMilestone.task.isMilestone, false);
    assert.equal(new Date(convertMilestone.task.dueDate!).getTime(), new Date("2026-09-08T10:00:00Z").getTime());

    // E. Task timezone and Recurrence update invariants
    // Reject invalid task timezone on update
    await assert.rejects(
      async () =>
        repository.update(normalTask.id, {
          expectedVersion: updateToDone.task.version,
          timezone: "Invalid/TZ_Region",
        }),
      (err: unknown) =>
        err instanceof TenantConflictError && /Task timezone must be a valid IANA timezone/.test(err.message),
    );

    // Reject invalid recurrence timezone on update
    await assert.rejects(
      async () =>
        repository.update(pausedRecurrenceTask.id, {
          expectedVersion: pausedRecurrenceTask.version,
          recurrence: {
            frequency: "monthly",
            monthDay: 15,
            timezone: "Narnia/Aslan",
          },
        }),
      (err: unknown) =>
        err instanceof TenantConflictError &&
        /Task recurrence timezone must be a valid IANA timezone/.test(err.message),
    );

    // Reject duplicate weekdays on recurrence update
    await assert.rejects(
      async () =>
        repository.update(pausedRecurrenceTask.id, {
          expectedVersion: pausedRecurrenceTask.version,
          recurrence: {
            frequency: "weekly",
            weekdays: [2, 2, 4],
          },
        }),
      (err: unknown) =>
        err instanceof TenantConflictError && /weekdays cannot contain duplicate days/.test(err.message),
    );

    // Update recurrence to completed status with valid IANA timezone
    const completedRecurrenceRes = await repository.update(pausedRecurrenceTask.id, {
      expectedVersion: pausedRecurrenceTask.version,
      recurrence: {
        frequency: "monthly",
        monthDay: 15,
        timezone: "America/New_York",
        status: "completed",
      },
    });
    assert.equal(completedRecurrenceRes.task.isRecurring, true);
    assert.equal(completedRecurrenceRes.task.recurrence?.status, "completed");
    assert.equal(completedRecurrenceRes.task.recurrence?.timezone, "America/New_York");

    // 3. Move & Cross-Path Parity
    // Move to done sets progress = 100
    const taskToMove = await repository.create({
      projectId,
      title: "Task to Move",
      status: "todo",
      progress: 35,
    });
    const movedToDone = await repository.move(taskToMove.id, {
      expectedVersion: taskToMove.version,
      status: "done",
      targetIndex: 0,
    });
    assert.equal(movedToDone.task.status, "done");
    assert.equal(movedToDone.task.progress, 100);

    // Move to canceled preserves progress
    const taskToCancel = await repository.create({
      projectId,
      title: "Task to Move Cancel",
      status: "in_progress",
      progress: 55,
    });
    const movedToCanceled = await repository.move(taskToCancel.id, {
      expectedVersion: taskToCancel.version,
      status: "canceled",
      targetIndex: 0,
    });
    assert.equal(movedToCanceled.task.status, "canceled");
    assert.equal(movedToCanceled.task.progress, 55);

    // Cross-path parity: update vs move to "done"
    assert.equal(updateToDone.task.status, movedToDone.task.status);
    assert.equal(updateToDone.task.progress, movedToDone.task.progress);

    // 4. State No-Op Verification (Mutation & Version Invariance)
    // A. Re-applying status = "done" on already done task with progress 100
    const currentDone = await repository.getById(updateToDone.task.id);
    const doneUpdatedAt = currentDone.updatedAt;
    const noopDoneRes = await repository.update(currentDone.id, {
      expectedVersion: currentDone.version,
      status: "done",
    });
    assert.equal(noopDoneRes.task.version, currentDone.version, "version must not increment on state no-op");
    assert.equal(
      new Date(noopDoneRes.task.updatedAt).getTime(),
      new Date(doneUpdatedAt).getTime(),
      "updatedAt must not change on state no-op",
    );

    // Verify in database directly
    const [dbDoneTask] = await db.select().from(tasks).where(eq(tasks.id, currentDone.id));
    assert.equal(dbDoneTask?.version, currentDone.version);
    assert.equal(new Date(dbDoneTask!.updatedAt).getTime(), new Date(doneUpdatedAt).getTime());

    // B. Re-applying same progress value
    const currentInProgress = await repository.getById(inProgress100.id);
    const progressUpdatedAt = currentInProgress.updatedAt;
    const noopProgressRes = await repository.update(currentInProgress.id, {
      expectedVersion: currentInProgress.version,
      progress: 100,
    });
    assert.equal(
      noopProgressRes.task.version,
      currentInProgress.version,
      "version must not increment on same progress",
    );
    assert.equal(
      new Date(noopProgressRes.task.updatedAt).getTime(),
      new Date(progressUpdatedAt).getTime(),
      "updatedAt must not change on same progress",
    );

    // C. Re-applying same dates
    const currentMilestoneTask = await repository.getById(convertMilestone.task.id);
    const datesUpdatedAt = currentMilestoneTask.updatedAt;
    const noopDatesRes = await repository.update(currentMilestoneTask.id, {
      expectedVersion: currentMilestoneTask.version,
      startDate: currentMilestoneTask.startDate ? new Date(currentMilestoneTask.startDate) : null,
      dueDate: currentMilestoneTask.dueDate ? new Date(currentMilestoneTask.dueDate) : null,
    });
    assert.equal(noopDatesRes.task.version, currentMilestoneTask.version, "version must not increment on same dates");
    assert.equal(
      new Date(noopDatesRes.task.updatedAt).getTime(),
      new Date(datesUpdatedAt).getTime(),
      "updatedAt must not change on same dates",
    );
  });
});
