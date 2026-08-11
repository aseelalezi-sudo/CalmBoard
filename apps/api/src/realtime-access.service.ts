import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  createAuthorizationRepository,
  createProjectsRepository,
  createTasksRepository,
  createWorkspaceRepository,
  withDatabaseContext,
} from "@calmboard/database";

export type RealtimeScope = {
  organizationId: string;
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
};

function identifier(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new ForbiddenException(`Invalid realtime ${field}`);
  }
  return value.trim();
}

export function parseRealtimeScope(input: unknown): RealtimeScope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ForbiddenException("Invalid realtime scope");
  }
  const record = input as Record<string, unknown>;
  const organizationId = identifier(record.organizationId, "organizationId");
  const workspaceId = record.workspaceId === undefined ? undefined : identifier(record.workspaceId, "workspaceId");
  const projectId = record.projectId === undefined ? undefined : identifier(record.projectId, "projectId");
  const taskId = record.taskId === undefined ? undefined : identifier(record.taskId, "taskId");
  if ((projectId || taskId) && !workspaceId) throw new ForbiddenException("Realtime workspace scope is required");
  return { organizationId, workspaceId, projectId, taskId };
}

@Injectable()
export class RealtimeAccessService {
  private readonly authorization = createAuthorizationRepository();

  async authorize(userId: string, rawScope: unknown): Promise<RealtimeScope> {
    const requested = parseRealtimeScope(rawScope);
    return withDatabaseContext(
      {
        organizationId: requested.organizationId,
        workspaceId: requested.workspaceId,
        actorId: userId,
      },
      async () => {
        let projectId = requested.projectId;
        if (requested.workspaceId) {
          const context = {
            organizationId: requested.organizationId,
            workspaceId: requested.workspaceId,
            actorId: userId,
          };
          await createWorkspaceRepository(context).get();
          if (requested.taskId) {
            const task = await createTasksRepository(context).getById(requested.taskId);
            if (projectId && task.projectId !== projectId) {
              throw new ForbiddenException("Realtime task scope does not belong to the project");
            }
            projectId = task.projectId;
          }
          if (projectId) await createProjectsRepository(context).getById(projectId);
        }

        const decision = await this.authorization.resolve(userId, {
          organizationId: requested.organizationId,
          workspaceId: requested.workspaceId,
          projectId,
        });
        if (!decision.member) throw new ForbiddenException("Realtime tenant access is denied");

        return { ...requested, ...(projectId ? { projectId } : {}) };
      },
    );
  }
}
