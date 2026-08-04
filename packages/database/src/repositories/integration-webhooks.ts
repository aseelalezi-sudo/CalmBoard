import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { integrationWebhookEndpoints, integrationWebhookReceipts, memberships, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export const integrationWebhookProviders = ["github", "slack", "webhook"] as const;
export type IntegrationWebhookProvider = (typeof integrationWebhookProviders)[number];

export type RecordIntegrationWebhookReceiptInput = {
  endpointId: string;
  provider: IntegrationWebhookProvider;
  deliveryId: string;
  payloadSha256: string;
  eventType: string;
  providerTimestamp?: Date | null;
};

export function isIntegrationWebhookProvider(value: string): value is IntegrationWebhookProvider {
  return integrationWebhookProviders.some((provider) => provider === value);
}

export function hashIntegrationWebhookEndpointToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeDisplayName(value: string) {
  const displayName = value.trim();
  if (!displayName || displayName.length > 160) throw new TenantConflictError("displayName is invalid");
  return displayName;
}

function toSummary(row: typeof integrationWebhookEndpoints.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    provider: row.provider as IntegrationWebhookProvider,
    displayName: row.displayName,
    status: row.status as "active" | "revoked",
    createdBy: row.createdBy,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createIntegrationWebhookEndpointsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const tenantScope = and(
    eq(integrationWebhookEndpoints.organizationId, organizationId),
    eq(integrationWebhookEndpoints.workspaceId, workspaceId),
  )!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.organizationId, organizationId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireManager() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required for webhook endpoint access");
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
          inArray(memberships.role, ["owner", "admin"]),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError();
  }

  return {
    async list() {
      await requireWorkspace();
      await requireManager();
      const rows = await db
        .select()
        .from(integrationWebhookEndpoints)
        .where(tenantScope)
        .orderBy(desc(integrationWebhookEndpoints.createdAt));
      return rows.map(toSummary);
    },

    async create(provider: IntegrationWebhookProvider, displayNameInput: string) {
      await requireWorkspace();
      await requireManager();
      const endpointToken = randomBytes(32).toString("base64url");
      const [endpoint] = await db
        .insert(integrationWebhookEndpoints)
        .values({
          organizationId,
          workspaceId,
          provider,
          displayName: normalizeDisplayName(displayNameInput),
          endpointKeyHash: hashIntegrationWebhookEndpointToken(endpointToken),
          createdBy: actorId!,
        })
        .returning();
      return { endpoint: toSummary(endpoint), endpointToken };
    },

    async revoke(id: string) {
      await requireWorkspace();
      await requireManager();
      const now = new Date();
      const [endpoint] = await db
        .update(integrationWebhookEndpoints)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(integrationWebhookEndpoints.id, id),
            tenantScope,
            eq(integrationWebhookEndpoints.status, "active"),
            isNull(integrationWebhookEndpoints.revokedAt),
          ),
        )
        .returning();
      if (!endpoint) throw new TenantResourceNotFoundError("integration webhook endpoint");
      return toSummary(endpoint);
    },
  };
}

export async function resolveIntegrationWebhookEndpoint(provider: IntegrationWebhookProvider, endpointToken: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(endpointToken)) return null;
  const result = await db.execute<{
    endpoint_id: string;
    organization_id: string;
    workspace_id: string;
  }>(sql`
    select endpoint_id, organization_id, workspace_id
    from public.resolve_integration_webhook_endpoint(
      ${provider},
      ${hashIntegrationWebhookEndpointToken(endpointToken)}
    )
  `);
  const row = result.rows[0];
  return row
    ? { endpointId: row.endpoint_id, organizationId: row.organization_id, workspaceId: row.workspace_id }
    : null;
}

export function createIntegrationWebhookReceiptsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  return {
    async record(input: RecordIntegrationWebhookReceiptInput) {
      const [inserted] = await db
        .insert(integrationWebhookReceipts)
        .values({
          endpointId: input.endpointId,
          organizationId,
          workspaceId,
          provider: input.provider,
          deliveryId: input.deliveryId,
          payloadSha256: input.payloadSha256,
          eventType: input.eventType,
          providerTimestamp: input.providerTimestamp ?? null,
        })
        .onConflictDoNothing({
          target: [integrationWebhookReceipts.endpointId, integrationWebhookReceipts.deliveryId],
        })
        .returning({ id: integrationWebhookReceipts.id });
      if (inserted) return { id: inserted.id, replayed: false as const };

      const [existing] = await db
        .select({ id: integrationWebhookReceipts.id, payloadSha256: integrationWebhookReceipts.payloadSha256 })
        .from(integrationWebhookReceipts)
        .where(
          and(
            eq(integrationWebhookReceipts.endpointId, input.endpointId),
            eq(integrationWebhookReceipts.organizationId, organizationId),
            eq(integrationWebhookReceipts.workspaceId, workspaceId),
            eq(integrationWebhookReceipts.deliveryId, input.deliveryId),
          ),
        )
        .limit(1);
      if (!existing) throw new TenantResourceNotFoundError("integration webhook receipt");
      if (existing.payloadSha256 !== input.payloadSha256) {
        throw new TenantConflictError("The webhook delivery ID was already used with a different payload");
      }
      return { id: existing.id, replayed: true as const };
    },
  };
}
