import type {
  Attachment,
  Comment,
  Project,
  ProjectBaseline,
  Task,
  TaskApproval,
  TaskChecklist,
  TaskRecurrence,
} from "@/lib/types";
import { apiServiceUrl, createIdempotencyKey, jsonRequest, request, requestJson } from "@/lib/client-api";

type TaskScope = {
  organizationId: string;
  workspaceId: string;
  actorId?: string;
};

export type CreateTaskInput = TaskScope & {
  projectId: string;
  title: string;
  description?: string | null;
  parentId?: string | null;
  status?: string;
  priority?: string;
  assigneeId?: string | null;
  assigneeIds?: string[];
  followerIds?: string[];
  reporterId?: string | null;
  tags?: string[];
  dueDate?: string | Date | null;
  storyPoints?: number | null;
  estimatedHours?: number | null;
  order?: number;
  reminders?: Task["reminders"];
  recurrence?: Partial<TaskRecurrence> & Pick<TaskRecurrence, "frequency">;
  isRecurring?: boolean;
};

export type UpdateTaskInput = TaskScope &
  Partial<Omit<Task, "recurrence">> & {
    id: string;
    expectedVersion: number;
    recurrence?: (Partial<TaskRecurrence> & Pick<TaskRecurrence, "frequency">) | null;
  };

export function createTaskRecord(input: CreateTaskInput) {
  return requestJson<Task>(
    apiServiceUrl("/tasks"),
    jsonRequest("POST", input, { "Idempotency-Key": createIdempotencyKey() }),
  );
}

export function importTaskRecords(input: TaskScope & { tasks: Array<Omit<CreateTaskInput, keyof TaskScope>> }) {
  return requestJson<{ items: Task[]; importedCount: number }>(
    apiServiceUrl("/tasks/import"),
    jsonRequest("POST", input, { "Idempotency-Key": createIdempotencyKey() }),
  );
}

export function updateTaskRecord(input: UpdateTaskInput) {
  return requestJson<Task>(apiServiceUrl("/tasks"), jsonRequest("PATCH", input));
}

export function moveTaskRecord(
  task: Pick<Task, "id" | "organizationId" | "workspaceId" | "version">,
  status: string,
  targetIndex: number,
  anchors: { beforeTaskId: string | null; afterTaskId: string | null },
  actorId?: string,
) {
  return requestJson<Task>(
    apiServiceUrl(`/tasks/${encodeURIComponent(task.id)}/move`),
    jsonRequest("PATCH", {
      organizationId: task.organizationId,
      workspaceId: task.workspaceId,
      actorId,
      status,
      targetIndex,
      ...anchors,
      expectedVersion: task.version,
    }),
  );
}

export function setProjectWipLimit(
  project: Pick<Project, "id" | "organizationId" | "workspaceId">,
  status: string,
  limit: number | null,
  actorId?: string,
) {
  return requestJson<Partial<Record<string, number>>>(
    apiServiceUrl(`/projects/${encodeURIComponent(project.id)}/wip-limits`),
    jsonRequest("PATCH", {
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      actorId,
      status,
      limit,
    }),
  );
}

export function getProjectBaselines(project: Pick<Project, "id" | "organizationId" | "workspaceId">, actorId?: string) {
  const query = new URLSearchParams({
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    projectId: project.id,
  });
  if (actorId) query.set("actorId", actorId);
  return requestJson<ProjectBaseline[]>(apiServiceUrl(`/project-baselines?${query.toString()}`));
}

export function createProjectBaselineRecord(
  project: Pick<Project, "id" | "organizationId" | "workspaceId">,
  name: string,
  actorId?: string,
) {
  return requestJson<ProjectBaseline>(
    apiServiceUrl("/project-baselines"),
    jsonRequest("POST", {
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      projectId: project.id,
      actorId,
      name,
    }),
  );
}

export async function deleteTaskRecord(task: Pick<Task, "id" | "organizationId" | "workspaceId">, actorId?: string) {
  const query = new URLSearchParams({
    organizationId: task.organizationId,
    workspaceId: task.workspaceId,
  });
  if (actorId) query.set("actorId", actorId);
  await request(`${apiServiceUrl(`/tasks/${encodeURIComponent(task.id)}`)}?${query.toString()}`, {
    method: "DELETE",
  });
}

export async function getTaskDetailBundle(task: Pick<Task, "id" | "organizationId" | "workspaceId">): Promise<{
  task: Task;
  comments: Comment[];
  attachments: Attachment[];
  subtasks: Task[];
  checklists: TaskChecklist[];
  approvals: TaskApproval[];
}> {
  const organizationId = encodeURIComponent(task.organizationId);
  const workspaceId = encodeURIComponent(task.workspaceId);
  const taskId = encodeURIComponent(task.id);
  const [details, subtasks] = await Promise.all([
    requestJson<{
      task: Task;
      comments?: Comment[];
      attachments?: Attachment[];
      checklists?: TaskChecklist[];
      approvals?: TaskApproval[];
    }>(`${apiServiceUrl(`/tasks/${taskId}`)}?organizationId=${organizationId}&workspaceId=${workspaceId}`),
    requestJson<Task[]>(
      `${apiServiceUrl("/tasks")}?parentId=${taskId}&organizationId=${organizationId}&workspaceId=${workspaceId}`,
    ),
  ]);

  return {
    task: details.task,
    comments: details.comments ?? [],
    attachments: details.attachments ?? [],
    subtasks: Array.isArray(subtasks) ? subtasks : [],
    checklists: details.checklists ?? [],
    approvals: details.approvals ?? [],
  };
}

export function projectTaskScope(project: Pick<Project, "id" | "organizationId" | "workspaceId">, actorId?: string) {
  return {
    projectId: project.id,
    organizationId: project.organizationId,
    workspaceId: project.workspaceId,
    actorId,
  };
}
