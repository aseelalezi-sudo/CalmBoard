import type { Sprint, Task } from "@/lib/types";

export type SprintSummary = {
  taskCount: number;
  completedCount: number;
  incompleteCount: number;
  storyPoints: number;
  completedStoryPoints: number;
  progress: number;
};

export function sprintSummary(tasks: Task[]): SprintSummary {
  const completed = tasks.filter((task) => task.status === "done");
  const storyPoints = tasks.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0);
  return {
    taskCount: tasks.length,
    completedCount: completed.length,
    incompleteCount: tasks.length - completed.length,
    storyPoints,
    completedStoryPoints: completed.reduce((sum, task) => sum + (task.storyPoints ?? 0), 0),
    progress: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
  };
}

export function tasksForProject(tasks: Task[], projectId: string) {
  return tasks.filter((task) => task.projectId === projectId);
}

export function groupSprintPlanning(tasks: Task[], sprints: Sprint[], projectId: string) {
  const projectTasks = tasksForProject(tasks, projectId);
  const writableIds = new Set(
    sprints.filter((sprint) => sprint.status === "planned" || sprint.status === "active").map((sprint) => sprint.id),
  );
  return {
    backlog: projectTasks.filter((task) => task.sprintId == null),
    bySprint: new Map(sprints.map((sprint) => [sprint.id, projectTasks.filter((task) => task.sprintId === sprint.id)])),
    writableTasks: projectTasks.filter((task) => task.sprintId == null || writableIds.has(task.sprintId)),
  };
}

export function validateSprintForm(input: SprintFormInputLike) {
  if (!input.name.trim()) return "name" as const;
  if (input.startsAt && Number.isNaN(new Date(input.startsAt).getTime())) return "startsAt" as const;
  if (input.endsAt && Number.isNaN(new Date(input.endsAt).getTime())) return "endsAt" as const;
  if (input.startsAt && input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) return "range" as const;
  return null;
}

type SprintFormInputLike = { name: string; startsAt?: string | null; endsAt?: string | null };

export function sprintAccess(can: (permission: string) => boolean) {
  return { canView: can("sprints.view"), canManage: can("sprints.manage") };
}
