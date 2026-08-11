import {
  createProjectsRepository,
  createProjectWorkflowRepository,
  type CreateProjectInput,
  type DatabaseTenantContext,
  type TaskStatus,
  type UpdateProjectInput,
} from "@calmboard/database";
import { logActivity } from "./automation-engine.js";

export function createProjectService(context: DatabaseTenantContext) {
  const workflow = createProjectWorkflowRepository(context);
  const projects = createProjectsRepository(context);
  async function record(
    action: string,
    project: { id: string; organizationId: string; workspaceId: string },
    newValues?: unknown,
  ) {
    if (!context.actorId) return;
    await logActivity({
      organizationId: project.organizationId,
      workspaceId: project.workspaceId,
      actorId: context.actorId,
      action,
      entityType: "project",
      entityId: project.id,
      newValues,
    });
  }
  return {
    list() {
      return projects.list();
    },
    async create(input: CreateProjectInput) {
      const project = await projects.create(input);
      await record("project.created", project, {
        name: project.name,
        status: project.status,
        template: project.template,
      });
      return project;
    },
    async update(projectId: string, expectedVersion: number, input: UpdateProjectInput) {
      const project = await projects.update(projectId, expectedVersion, input);
      await record("project.updated", project, input);
      return project;
    },
    async archive(projectId: string, expectedVersion: number) {
      const project = await projects.archive(projectId, expectedVersion);
      await record("project.archived", project, { status: project.status });
      return project;
    },
    async restore(projectId: string, expectedVersion: number) {
      const project = await projects.restore(projectId, expectedVersion);
      await record("project.restored", project, { status: project.status });
      return project;
    },
    async softDelete(projectId: string, expectedVersion: number) {
      const project = await projects.softDelete(projectId, expectedVersion);
      await record("project.deleted", project, { deletedAt: project.deletedAt });
      return project;
    },
    listWipLimits(projectId: string) {
      return workflow.listWipLimits(projectId);
    },
    setWipLimit(projectId: string, status: TaskStatus, limit: number | null) {
      return workflow.setWipLimit(projectId, status, limit);
    },
  };
}
