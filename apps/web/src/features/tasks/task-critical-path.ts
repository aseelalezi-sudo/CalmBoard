import type { TaskGanttLink, TaskGanttModel } from "./task-gantt-model";

const MINUTE_MS = 60_000;
const FLOAT_EPSILON_MINUTES = 0.001;

export type CriticalPathMetric = {
  taskId: string;
  durationMinutes: number;
  earliestStartMinutes: number;
  earliestFinishMinutes: number;
  latestStartMinutes: number;
  latestFinishMinutes: number;
  totalFloatMinutes: number;
  isCritical: boolean;
};

export type CriticalPathResult =
  | {
      status: "computed";
      projectDurationMinutes: number;
      metrics: CriticalPathMetric[];
      criticalTaskIds: string[];
      criticalLinks: TaskGanttLink[];
    }
  | {
      status: "no_scheduled_tasks" | "incomplete_dependencies" | "cyclic_dependencies";
      projectDurationMinutes: null;
      metrics: [];
      criticalTaskIds: [];
      criticalLinks: [];
    };

function taskDurationMinutes(startDate?: string, dueDate?: string) {
  if (!startDate || !dueDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(dueDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return (end - start) / MINUTE_MS;
}

function dependencyStartOffset(link: TaskGanttLink, blockingDuration: number, dependentDuration: number) {
  if (link.type === "finish_to_start") return blockingDuration + link.lagMinutes;
  if (link.type === "start_to_start") return link.lagMinutes;
  if (link.type === "finish_to_finish") {
    return blockingDuration + link.lagMinutes - dependentDuration;
  }
  return link.lagMinutes - dependentDuration;
}

export function calculateCriticalPath(model: TaskGanttModel): CriticalPathResult {
  if (!model.bars.length) {
    return {
      status: "no_scheduled_tasks",
      projectDurationMinutes: null,
      metrics: [],
      criticalTaskIds: [],
      criticalLinks: [],
    };
  }
  if (model.missingDependencySerials.length || model.unrenderedDependencyCount) {
    return {
      status: "incomplete_dependencies",
      projectDurationMinutes: null,
      metrics: [],
      criticalTaskIds: [],
      criticalLinks: [],
    };
  }

  const taskIds = model.bars.map((bar) => bar.task.id);
  const durationByTask = new Map(
    model.bars.map((bar) => [bar.task.id, taskDurationMinutes(bar.task.startDate, bar.task.dueDate)]),
  );
  const incomingCount = new Map(taskIds.map((taskId) => [taskId, 0]));
  const outgoing = new Map(taskIds.map((taskId) => [taskId, [] as TaskGanttLink[]]));
  for (const link of model.links) {
    incomingCount.set(link.dependentTaskId, (incomingCount.get(link.dependentTaskId) ?? 0) + 1);
    outgoing.get(link.blockingTaskId)?.push(link);
  }

  const queue = taskIds.filter((taskId) => incomingCount.get(taskId) === 0);
  const topologicalOrder: string[] = [];
  while (queue.length) {
    const taskId = queue.shift()!;
    topologicalOrder.push(taskId);
    for (const link of outgoing.get(taskId) ?? []) {
      const remaining = (incomingCount.get(link.dependentTaskId) ?? 0) - 1;
      incomingCount.set(link.dependentTaskId, remaining);
      if (remaining === 0) queue.push(link.dependentTaskId);
    }
  }
  if (topologicalOrder.length !== taskIds.length) {
    return {
      status: "cyclic_dependencies",
      projectDurationMinutes: null,
      metrics: [],
      criticalTaskIds: [],
      criticalLinks: [],
    };
  }

  const earliestStart = new Map(taskIds.map((taskId) => [taskId, 0]));
  for (const taskId of topologicalOrder) {
    const sourceStart = earliestStart.get(taskId) ?? 0;
    const sourceDuration = durationByTask.get(taskId) ?? 0;
    for (const link of outgoing.get(taskId) ?? []) {
      const targetDuration = durationByTask.get(link.dependentTaskId) ?? 0;
      const constrainedStart = sourceStart + dependencyStartOffset(link, sourceDuration, targetDuration);
      earliestStart.set(link.dependentTaskId, Math.max(earliestStart.get(link.dependentTaskId) ?? 0, constrainedStart));
    }
  }

  const projectDurationMinutes = Math.max(
    0,
    ...taskIds.map((taskId) => (earliestStart.get(taskId) ?? 0) + (durationByTask.get(taskId) ?? 0)),
  );
  const latestStart = new Map(
    taskIds.map((taskId) => [taskId, projectDurationMinutes - (durationByTask.get(taskId) ?? 0)]),
  );
  for (const taskId of [...topologicalOrder].reverse()) {
    for (const link of outgoing.get(taskId) ?? []) {
      const sourceDuration = durationByTask.get(taskId) ?? 0;
      const targetDuration = durationByTask.get(link.dependentTaskId) ?? 0;
      const permittedStart =
        (latestStart.get(link.dependentTaskId) ?? 0) - dependencyStartOffset(link, sourceDuration, targetDuration);
      latestStart.set(taskId, Math.min(latestStart.get(taskId) ?? permittedStart, permittedStart));
    }
  }

  const metrics = topologicalOrder.map<CriticalPathMetric>((taskId) => {
    const durationMinutes = durationByTask.get(taskId) ?? 0;
    const earliestStartMinutes = earliestStart.get(taskId) ?? 0;
    const latestStartMinutes = latestStart.get(taskId) ?? earliestStartMinutes;
    const totalFloatMinutes = Math.max(0, latestStartMinutes - earliestStartMinutes);
    return {
      taskId,
      durationMinutes,
      earliestStartMinutes,
      earliestFinishMinutes: earliestStartMinutes + durationMinutes,
      latestStartMinutes,
      latestFinishMinutes: latestStartMinutes + durationMinutes,
      totalFloatMinutes,
      isCritical: totalFloatMinutes <= FLOAT_EPSILON_MINUTES,
    };
  });
  const criticalTaskIds = metrics.filter((metric) => metric.isCritical).map((metric) => metric.taskId);
  const criticalTaskIdSet = new Set(criticalTaskIds);
  const criticalLinks = model.links.filter((link) => {
    if (!criticalTaskIdSet.has(link.blockingTaskId) || !criticalTaskIdSet.has(link.dependentTaskId)) {
      return false;
    }
    const sourceStart = earliestStart.get(link.blockingTaskId) ?? 0;
    const sourceDuration = durationByTask.get(link.blockingTaskId) ?? 0;
    const targetDuration = durationByTask.get(link.dependentTaskId) ?? 0;
    const targetStart = earliestStart.get(link.dependentTaskId) ?? 0;
    return (
      Math.abs(targetStart - (sourceStart + dependencyStartOffset(link, sourceDuration, targetDuration))) <=
      FLOAT_EPSILON_MINUTES
    );
  });

  return {
    status: "computed",
    projectDurationMinutes,
    metrics,
    criticalTaskIds,
    criticalLinks,
  };
}
