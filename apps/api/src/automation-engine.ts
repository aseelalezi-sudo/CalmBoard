import { createActivitiesRepository } from "@calmboard/database";

export async function logActivity(input: {
  organizationId: string;
  workspaceId: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
  ip?: string;
}) {
  try {
    await createActivitiesRepository(input).create({
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValues: input.oldValues ?? null,
      newValues: input.newValues ?? null,
      ip: input.ip,
    });
  } catch {
    // Activity logging must never break the main request path.
  }
}
