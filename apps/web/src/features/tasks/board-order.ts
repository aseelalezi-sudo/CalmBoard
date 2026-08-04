import type { Task } from "@/lib/types";
import { STATUS_ORDER } from "@/lib/types";

export function reorderBoardTasks(tasks: Task[], taskId: string, targetStatus: string, targetIndex: number) {
  const moving = tasks.find((task) => task.id === taskId);
  if (!moving) return tasks;
  const sourceStatus = moving.status;
  const source = tasks.filter((task) => task.status === sourceStatus && task.id !== taskId);
  const target =
    sourceStatus === targetStatus ? source : tasks.filter((task) => task.status === targetStatus && task.id !== taskId);
  const insertionIndex = Math.max(0, Math.min(targetIndex, target.length));
  const targetWithMoving = [...target];
  targetWithMoving.splice(insertionIndex, 0, {
    ...moving,
    status: targetStatus,
    progress: targetStatus === "done" ? 100 : moving.progress,
  });
  const orders = new Map<string, { status: string; order: number }>();
  if (sourceStatus !== targetStatus) {
    source.forEach((task, order) => orders.set(task.id, { status: sourceStatus, order }));
  }
  targetWithMoving.forEach((task, order) => orders.set(task.id, { status: targetStatus, order }));
  const statusRank = (status: string) => {
    const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
    return index < 0 ? STATUS_ORDER.length : index;
  };
  return tasks
    .map((task) => {
      const placement = orders.get(task.id);
      return placement
        ? {
            ...task,
            status: placement.status,
            order: placement.order,
            ...(task.id === taskId && targetStatus === "done" ? { progress: 100 } : {}),
          }
        : task;
    })
    .sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.order - right.order);
}
