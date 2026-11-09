import { and, eq, inArray, sql, type AnyColumn } from "drizzle-orm";
import { db, withDatabaseContext } from "./client.js";
import { assertExportProjectAccess } from "./export-access.js";
import { TenantPermissionDeniedError } from "./errors.js";
import { accessibleProjectIds } from "./project-access.js";
import { tasks, sprints, taskApprovalRequests, taskChecklistItems, notifications } from "./schema.js";
import type { DatabaseTenantContext } from "./tenant-context.js";
import { createAuthorizationRepository } from "./repositories/authorization.js";

export async function entityVisibility(context: DatabaseTenantContext, type: AnyColumn, id: AnyColumn) {
  const projectIds = await accessibleProjectIds(context, true);
  const scopedIds = (table: typeof tasks | typeof sprints | typeof taskApprovalRequests | typeof taskChecklistItems) =>
    db
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.organizationId, context.organizationId),
          eq(table.workspaceId, context.workspaceId!),
          inArray(table.projectId, projectIds),
        ),
      );
  let allowUnscoped = false;
  try {
    await assertExportProjectAccess(context, false);
    allowUnscoped = true;
  } catch (error) {
    if (!(error instanceof TenantPermissionDeniedError)) throw error;
  }
  // Unknown/legacy messages may embed task data in their body without recording
  // an entity. Only a subject who can read all private projects may see those.
  return sql<boolean>`case
    when ${type} = 'project' then ${inArray(id, projectIds)}
    when ${type} = 'task' then ${inArray(id, scopedIds(tasks))}
    when ${type} = 'sprint' then ${inArray(id, scopedIds(sprints))}
    when ${type} = 'task_approval' then ${inArray(id, scopedIds(taskApprovalRequests))}
    when ${type} = 'task_checklist_item' then ${inArray(id, scopedIds(taskChecklistItems))}
    when ${type} in ('workspace','invitation','integration','integration_credential','integration_webhook','subscription') then true
    else ${allowUnscoped}
  end`;
}

export async function canReadNotification(context: DatabaseTenantContext, notificationId: string) {
  if (!context.actorId) return false;
  const actorId = context.actorId;
  return withDatabaseContext(context, async () => {
    if (!(await createAuthorizationRepository().resolve(actorId, context)).member) return false;
    const condition = await entityVisibility(context, notifications.entityType, notifications.entityId);
    const [notification] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.organizationId, context.organizationId),
          eq(notifications.workspaceId, context.workspaceId!),
          eq(notifications.userId, actorId),
          condition,
        ),
      )
      .limit(1);
    return Boolean(notification);
  });
}
