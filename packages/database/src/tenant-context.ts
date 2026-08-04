import type { TenantScope } from "@calmboard/types";

export type DatabaseTenantContext = TenantScope & {
  actorId?: string;
  automation?: {
    parentEventId: string;
    depth: number;
  };
};

export type WorkspaceTenantContext = DatabaseTenantContext & {
  workspaceId: string;
};

export function assertTenantContext(context: Partial<DatabaseTenantContext>): asserts context is DatabaseTenantContext {
  if (!context.organizationId) {
    throw new Error("organizationId is required for database access");
  }
}

export function assertWorkspaceTenantContext(
  context: Partial<DatabaseTenantContext>,
): asserts context is WorkspaceTenantContext {
  assertTenantContext(context);
  if (!context.workspaceId) {
    throw new Error("workspaceId is required for workspace database access");
  }
}
