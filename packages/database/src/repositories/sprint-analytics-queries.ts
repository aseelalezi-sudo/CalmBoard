import { and, asc, desc, eq, inArray, sql, isNotNull, type SQL } from "drizzle-orm";
import { db } from "../client.js";
import { sprints, sprintSnapshots, sprintAnalyticsEvents, tasks } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { AnalyticsIntegrityError, TenantResourceNotFoundError } from "../errors.js";

type SnapshotRecord = typeof sprintSnapshots.$inferSelect;

export function createSprintAnalyticsQueries(context: DatabaseTenantContext) {
  const { organizationId, workspaceId } = context;
  assertWorkspaceTenantContext(context);

  async function getSnapshot(sprintId: string, type: "start" | "complete", transaction: any = db) {
    return transaction.query.sprintSnapshots.findFirst({
      where: and(
        eq(sprintSnapshots.sprintId, sprintId),
        eq(sprintSnapshots.organizationId, organizationId),
        eq(sprintSnapshots.snapshotType, type),
      ),
    });
  }

  async function getSprintSummary(sprintId: string, projectId: string) {
    const [sprint, startSnap, completeSnap] = await Promise.all([
      db.query.sprints.findFirst({
        where: and(
          eq(sprints.id, sprintId),
          eq(sprints.organizationId, organizationId),
          eq(sprints.projectId, projectId),
        ),
      }),
      getSnapshot(sprintId, "start"),
      getSnapshot(sprintId, "complete"),
    ]);

    if (!sprint) return null;

    const summary = {
      sprint: {
        id: sprint.id,
        name: sprint.name,
        status: sprint.status,
        startedAt: sprint.startedAt,
        completedAt: sprint.completedAt,
        cancelledAt: sprint.cancelledAt,
      },
      commitment: startSnap
        ? {
            taskCount: startSnap.scopeTaskCount,
            storyPoints: startSnap.scopeStoryPoints,
          }
        : null,
      finalScope: completeSnap
        ? {
            taskCount: completeSnap.scopeTaskCount,
            storyPoints: completeSnap.scopeStoryPoints,
          }
        : null,
      completed: completeSnap
        ? {
            taskCount: completeSnap.completedTaskCount,
            storyPoints: completeSnap.completedStoryPoints,
          }
        : null,
      remaining: completeSnap
        ? {
            taskCount: completeSnap.remainingTaskCount,
            storyPoints: completeSnap.remainingStoryPoints,
          }
        : null,
      netScopeChange:
        startSnap && completeSnap
          ? {
              taskCount: completeSnap.scopeTaskCount - startSnap.scopeTaskCount,
              storyPoints: (completeSnap.scopeStoryPoints ?? 0) - (startSnap.scopeStoryPoints ?? 0),
            }
          : null,
      completionRatio: completeSnap
        ? {
            tasks:
              completeSnap.scopeTaskCount > 0 ? completeSnap.completedTaskCount / completeSnap.scopeTaskCount : null,
            storyPoints:
              (completeSnap.scopeStoryPoints ?? 0) > 0
                ? (completeSnap.completedStoryPoints ?? 0) / (completeSnap.scopeStoryPoints ?? 0)
                : null,
          }
        : null,
      dataQuality: {
        start: startSnap?.dataQuality ?? null,
        complete: completeSnap?.dataQuality ?? null,
      },
      availability: {
        commitment: !!startSnap,
        completion: !!completeSnap,
        timeline: !!(startSnap && startSnap.dataQuality === "exact"),
      },
    };

    return summary;
  }

  async function getVelocitySeries(projectId: string, limit: number = 10) {
    const eligibleSprints = await db
      .select({
        sprintId: sprints.id,
        sprintName: sprints.name,
        completedAt: sprints.completedAt,
        completedStoryPoints: sprintSnapshots.completedStoryPoints,
        completedTaskCount: sprintSnapshots.completedTaskCount,
        dataQuality: sprintSnapshots.dataQuality,
      })
      .from(sprints)
      .innerJoin(
        sprintSnapshots,
        and(
          eq(sprints.id, sprintSnapshots.sprintId),
          eq(sprintSnapshots.organizationId, organizationId),
          eq(sprintSnapshots.snapshotType, "complete"),
          eq(sprintSnapshots.dataQuality, "exact"),
          isNotNull(sprintSnapshots.completedStoryPoints),
        ),
      )
      .where(
        and(
          eq(sprints.projectId, projectId),
          eq(sprints.organizationId, organizationId),
          eq(sprints.status, "completed"),
        ),
      )
      .orderBy(desc(sprints.completedAt))
      .limit(limit);

    eligibleSprints.reverse(); // Chronological ascending

    let sumPoints = 0;
    let count = 0;
    for (const s of eligibleSprints) {
      if (s.completedStoryPoints !== null) {
        sumPoints += Number(s.completedStoryPoints);
        count++;
      }
    }

    const averageStoryPoints = count > 0 ? sumPoints / count : 0;

    return {
      series: eligibleSprints,
      averageStoryPoints,
      sprintCount: count,
    };
  }

  async function getProjectSprintAnalyticsOverview(projectId: string) {
    const velocity = await getVelocitySeries(projectId, 10);

    const activeSprint = await db.query.sprints.findFirst({
      where: and(
        eq(sprints.projectId, projectId),
        eq(sprints.organizationId, organizationId),
        eq(sprints.status, "active"),
      ),
    });

    let activeSprintAnalytics = null;
    if (activeSprint) {
      activeSprintAnalytics = await getSprintSummary(activeSprint.id, projectId);
    }

    return {
      recentVelocity: velocity.series,
      averageVelocity: velocity.averageStoryPoints,
      exactCompletedSprintCount: velocity.sprintCount,
      activeSprint: activeSprintAnalytics,
    };
  }

  function toDateString(date: Date, timezone: string): string {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = f.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    return `${year}-${month}-${day}`;
  }

  async function getSprintTimeline(sprintId: string, projectId: string, timezone: string = "UTC") {
    return await db.transaction(
      async (tx) => {
        const sprint = await tx.query.sprints.findFirst({
          where: and(
            eq(sprints.id, sprintId),
            eq(sprints.organizationId, organizationId),
            eq(sprints.projectId, projectId),
          ),
        });
        if (!sprint) throw new TenantResourceNotFoundError("sprint");

        const startSnap = await getSnapshot(sprintId, "start", tx);
        if (!startSnap || startSnap.dataQuality !== "exact") {
          return { availability: { timeline: false } };
        }

        const completeSnap = sprint.status === "completed" ? await getSnapshot(sprintId, "complete", tx) : undefined;

        const events = await tx.query.sprintAnalyticsEvents.findMany({
          where: and(
            eq(sprintAnalyticsEvents.sprintId, sprintId),
            eq(sprintAnalyticsEvents.organizationId, organizationId),
          ),
          orderBy: [asc(sprintAnalyticsEvents.occurredAt), asc(sprintAnalyticsEvents.eventSequence)],
        });

        const state = {
          scopeTaskCount: startSnap.scopeTaskCount,
          scopeStoryPoints: Number(startSnap.scopeStoryPoints ?? 0),
          completedTaskCount: startSnap.completedTaskCount,
          completedStoryPoints: Number(startSnap.completedStoryPoints ?? 0),
          remainingTaskCount: startSnap.remainingTaskCount,
          remainingStoryPoints: Number(startSnap.remainingStoryPoints ?? 0),
        };

        type DailyPoint = {
          date: string;
          scopeStoryPoints: number;
          completedStoryPoints: number;
          remainingStoryPoints: number;
          scopeTaskCount: number;
          completedTaskCount: number;
          remainingTaskCount: number;
        };

        const dailyPoints = new Map<string, DailyPoint>();

        function captureDailyState(dateStr: string) {
          dailyPoints.set(dateStr, {
            date: dateStr,
            scopeStoryPoints: state.scopeStoryPoints,
            completedStoryPoints: state.completedStoryPoints,
            remainingStoryPoints: state.remainingStoryPoints,
            scopeTaskCount: state.scopeTaskCount,
            completedTaskCount: state.completedTaskCount,
            remainingTaskCount: state.remainingTaskCount,
          });
        }

        function invariantCheck() {
          if (state.scopeTaskCount !== state.completedTaskCount + state.remainingTaskCount) {
            throw new AnalyticsIntegrityError("scopeTaskCount != completedTaskCount + remainingTaskCount");
          }
          if (state.scopeStoryPoints !== state.completedStoryPoints + state.remainingStoryPoints) {
            throw new AnalyticsIntegrityError("scopeStoryPoints != completedStoryPoints + remainingStoryPoints");
          }
          if (
            state.scopeTaskCount < 0 ||
            state.completedTaskCount < 0 ||
            state.remainingTaskCount < 0 ||
            state.scopeStoryPoints < 0 ||
            state.completedStoryPoints < 0 ||
            state.remainingStoryPoints < 0
          ) {
            throw new AnalyticsIntegrityError("State metrics cannot be negative");
          }
        }

        const boundaryEndTime =
          sprint.status === "completed" && completeSnap
            ? completeSnap.capturedAt.getTime()
            : sprint.status === "cancelled" && sprint.cancelledAt
              ? sprint.cancelledAt.getTime()
              : Date.now();

        captureDailyState(toDateString(startSnap.capturedAt, timezone));

        for (const ev of events) {
          if (ev.occurredAt.getTime() > boundaryEndTime) {
            continue;
          }

          const isCompleted = ev.isCompletedAtEvent;

          if (ev.eventType === "task_added") {
            state.scopeTaskCount += 1;
            if (isCompleted) state.completedTaskCount += 1;
            else state.remainingTaskCount += 1;
            const pts = Number(ev.storyPointsAtEvent ?? 0);
            state.scopeStoryPoints += pts;
            if (isCompleted) state.completedStoryPoints += pts;
            else state.remainingStoryPoints += pts;
          } else if (ev.eventType === "task_removed") {
            state.scopeTaskCount -= 1;
            if (isCompleted) state.completedTaskCount -= 1;
            else state.remainingTaskCount -= 1;
            const pts = Number(ev.storyPointsAtEvent ?? 0);
            state.scopeStoryPoints -= pts;
            if (isCompleted) state.completedStoryPoints -= pts;
            else state.remainingStoryPoints -= pts;
          } else if (ev.eventType === "story_points_changed") {
            const oldPts = Number(ev.oldStoryPoints ?? 0);
            const newPts = Number(ev.newStoryPoints ?? 0);
            const delta = newPts - oldPts;
            state.scopeStoryPoints += delta;
            if (isCompleted) state.completedStoryPoints += delta;
            else state.remainingStoryPoints += delta;
          } else if (ev.eventType === "task_completed") {
            const pts = Number(ev.storyPointsAtEvent ?? 0);
            state.remainingTaskCount -= 1;
            state.completedTaskCount += 1;
            state.remainingStoryPoints -= pts;
            state.completedStoryPoints += pts;
          } else if (ev.eventType === "task_reopened") {
            const pts = Number(ev.storyPointsAtEvent ?? 0);
            state.completedTaskCount -= 1;
            state.remainingTaskCount += 1;
            state.completedStoryPoints -= pts;
            state.remainingStoryPoints += pts;
          }

          invariantCheck();
          captureDailyState(toDateString(ev.occurredAt, timezone));
        }

        if (sprint.status === "completed" && completeSnap) {
          if (
            state.scopeTaskCount !== completeSnap.scopeTaskCount ||
            state.completedTaskCount !== completeSnap.completedTaskCount ||
            state.remainingTaskCount !== completeSnap.remainingTaskCount ||
            state.scopeStoryPoints !== Number(completeSnap.scopeStoryPoints ?? 0) ||
            state.completedStoryPoints !== Number(completeSnap.completedStoryPoints ?? 0) ||
            state.remainingStoryPoints !== Number(completeSnap.remainingStoryPoints ?? 0)
          ) {
            throw new AnalyticsIntegrityError("Reconstructed timeline does not match Complete Snapshot exactly");
          }
        }

        const sortedDates = Array.from(dailyPoints.keys()).sort();
        let continuousDailyPoints: DailyPoint[] = [];
        if (sortedDates.length > 0) {
          const firstDateStr = sortedDates[0];

          let currDate = new Date(startSnap.capturedAt.getTime());
          currDate.setUTCHours(0, 0, 0, 0); // Normalized to day start
          const lastBoundaryDate = new Date(boundaryEndTime);
          lastBoundaryDate.setUTCHours(0, 0, 0, 0);

          let lastKnownState = dailyPoints.get(firstDateStr)!;

          while (currDate <= lastBoundaryDate) {
            const currentStr = toDateString(currDate, timezone);
            if (dailyPoints.has(currentStr)) {
              lastKnownState = dailyPoints.get(currentStr)!;
            }
            // Avoid duplicate dates if timezone creates weird overlapping strings when iterating purely in UTC
            if (
              continuousDailyPoints.length === 0 ||
              continuousDailyPoints[continuousDailyPoints.length - 1].date !== currentStr
            ) {
              continuousDailyPoints.push({
                ...lastKnownState,
                date: currentStr,
              });
            }
            currDate.setUTCDate(currDate.getUTCDate() + 1);
          }
        }

        return {
          availability: { timeline: true },
          isFinalized: sprint.status === "completed",
          series: continuousDailyPoints,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  }

  return {
    getSprintSummary,
    getVelocitySeries,
    getSprintTimeline,
    getProjectSprintAnalyticsOverview,
  };
}
