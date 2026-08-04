import type { ProjectBaseline, Task } from "@/lib/types";
import type { TaskGanttModel } from "./task-gantt-model";

const MINUTE_MS = 60_000;

function time(value?: string | null) {
  if (!value) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}

export type ScheduleConflict = {
  blockingTaskId: string;
  dependentTaskId: string;
  violationMinutes: number;
  type: string;
};

export function detectScheduleConflicts(model: TaskGanttModel): ScheduleConflict[] {
  const taskById = new Map(model.bars.map((bar) => [bar.task.id, bar.task]));
  const conflicts: ScheduleConflict[] = [];
  for (const link of model.links) {
    const blocking = taskById.get(link.blockingTaskId);
    const dependent = taskById.get(link.dependentTaskId);
    if (!blocking || !dependent) continue;
    const blockingStart = time(blocking.startDate ?? blocking.dueDate);
    const blockingFinish = time(blocking.dueDate ?? blocking.startDate);
    const dependentStart = time(dependent.startDate ?? dependent.dueDate);
    const dependentFinish = time(dependent.dueDate ?? dependent.startDate);
    if (blockingStart === null || blockingFinish === null || dependentStart === null || dependentFinish === null)
      continue;
    const lag = link.lagMinutes * MINUTE_MS;
    const required =
      link.type === "finish_to_start"
        ? blockingFinish + lag
        : link.type === "start_to_start"
          ? blockingStart + lag
          : link.type === "finish_to_finish"
            ? blockingFinish + lag
            : blockingStart + lag;
    const actual =
      link.type === "finish_to_finish" || link.type === "start_to_finish" ? dependentFinish : dependentStart;
    if (actual < required) {
      conflicts.push({
        blockingTaskId: blocking.id,
        dependentTaskId: dependent.id,
        violationMinutes: (required - actual) / MINUTE_MS,
        type: link.type,
      });
    }
  }
  return conflicts;
}

export type BaselineVariance = {
  taskId: string;
  serial: string;
  title: string;
  kind: "added" | "removed" | "changed";
  startVarianceMinutes: number | null;
  dueVarianceMinutes: number | null;
  milestoneChanged: boolean;
};

export function compareProjectBaseline(tasks: Task[], baseline: ProjectBaseline | null): BaselineVariance[] {
  if (!baseline) return [];
  const currentById = new Map(tasks.map((task) => [task.id, task]));
  const snapshotById = new Map(baseline.tasks.map((task) => [task.sourceTaskId, task]));
  const variances: BaselineVariance[] = [];
  for (const task of tasks) {
    const snapshot = snapshotById.get(task.id);
    if (!snapshot) {
      variances.push({
        taskId: task.id,
        serial: task.serial,
        title: task.title,
        kind: "added",
        startVarianceMinutes: null,
        dueVarianceMinutes: null,
        milestoneChanged: false,
      });
      continue;
    }
    const currentStart = time(task.startDate);
    const baselineStart = time(snapshot.startDate);
    const currentDue = time(task.dueDate);
    const baselineDue = time(snapshot.dueDate);
    const startVarianceMinutes =
      currentStart === null || baselineStart === null
        ? currentStart === baselineStart
          ? 0
          : null
        : (currentStart - baselineStart) / MINUTE_MS;
    const dueVarianceMinutes =
      currentDue === null || baselineDue === null
        ? currentDue === baselineDue
          ? 0
          : null
        : (currentDue - baselineDue) / MINUTE_MS;
    const milestoneChanged = Boolean(task.isMilestone) !== snapshot.isMilestone;
    if (startVarianceMinutes !== 0 || dueVarianceMinutes !== 0 || milestoneChanged) {
      variances.push({
        taskId: task.id,
        serial: task.serial,
        title: task.title,
        kind: "changed",
        startVarianceMinutes,
        dueVarianceMinutes,
        milestoneChanged,
      });
    }
  }
  for (const snapshot of baseline.tasks) {
    if (!currentById.has(snapshot.sourceTaskId)) {
      variances.push({
        taskId: snapshot.sourceTaskId,
        serial: snapshot.serial,
        title: snapshot.title,
        kind: "removed",
        startVarianceMinutes: null,
        dueVarianceMinutes: null,
        milestoneChanged: false,
      });
    }
  }
  return variances;
}
