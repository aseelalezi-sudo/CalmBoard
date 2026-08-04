import {
  createProjectsRepository,
  createProjectWorkflowRepository,
  type CreateProjectInput,
  type DatabaseTenantContext,
  type TaskStatus,
} from "@calmboard/database";
import { logActivity } from "./automation-engine.js";

export function createProjectService(context: DatabaseTenantContext) {
  const workflow = createProjectWorkflowRepository(context);
  return {
    list() {
      return createProjectsRepository(context).list();
    },
    async create(input: CreateProjectInput) {
      const project = await createProjectsRepository(context).create(input);
      if (context.actorId) {
        await logActivity({
          organizationId: project.organizationId,
          workspaceId: project.workspaceId,
          actorId: context.actorId,
          action: "project.created",
          entityType: "project",
          entityId: project.id,
          newValues: { name: project.name, status: project.status, template: project.template },
        });
      }
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
