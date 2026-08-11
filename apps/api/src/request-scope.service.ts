import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  db,
  sprints,
  taskApprovalRequests,
  taskChecklistItems,
  tasks,
  withDatabaseContext,
  type DatabaseTenantContext,
} from "@calmboard/database";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyRequest } from "fastify";

export type ScopeRequest = Pick<FastifyRequest, "url"> & {
  body?: unknown;
  query?: unknown;
  params?: unknown;
};

export type RequestResourceIds = {
  taskIds: string[];
  sprintIds: string[];
  checklistItemIds: string[];
  approvalRequestIds: string[];
};

export type ExplicitRequestScope = {
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
  resources: RequestResourceIds;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function identifier(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identifiers(...values: unknown[]) {
  return [...new Set(values.map(identifier).filter((value): value is string => Boolean(value)))];
}

export function matchingScopeIdentifier(field: string, ...values: unknown[]) {
  const unique = identifiers(...values);
  if (unique.length > 1) throw new BadRequestException(`Conflicting ${field} values`);
  return unique[0];
}

export function explicitRequestScope(request: ScopeRequest): ExplicitRequestScope {
  const body = record(request.body);
  const query = record(request.query);
  const params = record(request.params);
  const path = request.url.split("?", 1)[0] ?? request.url;
  const workspacePathId = /^\/workspaces\/[^/]+(?:\/|$)/.test(path) ? params.id : undefined;
  const projectPathId = /^\/projects\/[^/]+(?:\/|$)/.test(path) ? params.id : undefined;
  const taskPathId = /^\/tasks\/[^/]+(?:\/|$)/.test(path) ? params.id : undefined;
  const taskBodyId = /^\/tasks(?:\/|$)/.test(path) ? body.id : undefined;
  const incompleteDestination = record(body.incompleteTaskDestination);

  return {
    organizationId: matchingScopeIdentifier(
      "organizationId",
      params.organizationId,
      body.organizationId,
      query.organizationId,
    ),
    workspaceId: matchingScopeIdentifier(
      "workspaceId",
      params.workspaceId,
      workspacePathId,
      body.workspaceId,
      query.workspaceId,
    ),
    projectId: matchingScopeIdentifier("projectId", params.projectId, projectPathId, body.projectId, query.projectId),
    resources: {
      taskIds: identifiers(params.taskId, taskPathId, taskBodyId, body.taskId, query.taskId),
      sprintIds: identifiers(
        params.sprintId,
        body.sprintId,
        query.sprintId,
        body.targetSprintId,
        body.expectedFromSprintId,
        incompleteDestination.sprintId,
      ),
      checklistItemIds: identifiers(params.itemId),
      approvalRequestIds: identifiers(params.approvalRequestId),
    },
  };
}

@Injectable()
export class RequestScopeService {
  constructor(@Inject("REQUEST_SCOPE_DATABASE") private readonly database: typeof db = db) {}

  async trustedProjectId(context: DatabaseTenantContext, resources: RequestResourceIds) {
    const requestedCount =
      resources.taskIds.length +
      resources.sprintIds.length +
      resources.checklistItemIds.length +
      resources.approvalRequestIds.length;
    if (!requestedCount) return undefined;
    if (!context.workspaceId) throw new BadRequestException("workspaceId is required for scoped resources");
    const workspaceId = context.workspaceId;

    return withDatabaseContext(context, async () => {
      const projectIds: string[] = [];
      const collect = (rows: Array<{ projectId: string }>, expected: number) => {
        if (rows.length !== expected) throw new NotFoundException("Resource not found");
        projectIds.push(...rows.map((row) => row.projectId));
      };

      if (resources.taskIds.length) {
        collect(
          await this.database
            .select({ projectId: tasks.projectId })
            .from(tasks)
            .where(
              and(
                inArray(tasks.id, resources.taskIds),
                eq(tasks.organizationId, context.organizationId),
                eq(tasks.workspaceId, workspaceId),
                isNull(tasks.deletedAt),
              ),
            ),
          resources.taskIds.length,
        );
      }
      if (resources.sprintIds.length) {
        collect(
          await this.database
            .select({ projectId: sprints.projectId })
            .from(sprints)
            .where(
              and(
                inArray(sprints.id, resources.sprintIds),
                eq(sprints.organizationId, context.organizationId),
                eq(sprints.workspaceId, workspaceId),
                isNull(sprints.deletedAt),
              ),
            ),
          resources.sprintIds.length,
        );
      }
      if (resources.checklistItemIds.length) {
        collect(
          await this.database
            .select({ projectId: taskChecklistItems.projectId })
            .from(taskChecklistItems)
            .where(
              and(
                inArray(taskChecklistItems.id, resources.checklistItemIds),
                eq(taskChecklistItems.organizationId, context.organizationId),
                eq(taskChecklistItems.workspaceId, workspaceId),
                isNull(taskChecklistItems.deletedAt),
              ),
            ),
          resources.checklistItemIds.length,
        );
      }
      if (resources.approvalRequestIds.length) {
        collect(
          await this.database
            .select({ projectId: taskApprovalRequests.projectId })
            .from(taskApprovalRequests)
            .where(
              and(
                inArray(taskApprovalRequests.id, resources.approvalRequestIds),
                eq(taskApprovalRequests.organizationId, context.organizationId),
                eq(taskApprovalRequests.workspaceId, workspaceId),
                isNull(taskApprovalRequests.deletedAt),
              ),
            ),
          resources.approvalRequestIds.length,
        );
      }

      const uniqueProjects = [...new Set(projectIds)];
      if (uniqueProjects.length !== 1)
        throw new NotFoundException("Nested resources do not belong to the same project");
      return uniqueProjects[0];
    });
  }
}
