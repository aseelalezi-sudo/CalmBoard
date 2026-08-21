import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantConflictError, TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { customFields, memberships, projects, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { validateCustomFieldDefinition } from "../custom-field-contract.js";

export type CustomFieldRecord = typeof customFields.$inferSelect;
export type CustomFieldOption = { label: string; value: string; color?: string };
export type CreateCustomFieldInput = {
  name: string;
  key: string;
  type: string;
  projectId?: string | null;
  description?: string | null;
  required?: boolean;
  sensitive?: boolean;
  options?: CustomFieldOption[];
  order?: number;
};

export function createCustomFieldsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const tenantScope = and(
    eq(customFields.organizationId, organizationId),
    eq(customFields.workspaceId, workspaceId),
    isNull(customFields.deletedAt),
  )!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireProject(projectId: string) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          eq(projects.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!project) throw new TenantResourceNotFoundError("project");
  }

  async function requireActor() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required to manage custom fields");
    const [membership] = await db
      .select({ id: memberships.id, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership || !["owner", "admin", "manager"].includes(membership.role)) {
      throw new TenantPermissionDeniedError("custom field management requires manager access");
    }
  }

  return {
    async list() {
      await requireWorkspace();
      return db.select().from(customFields).where(tenantScope).orderBy(asc(customFields.order));
    },

    async create(input: CreateCustomFieldInput) {
      await requireWorkspace();
      await requireActor();
      const validated = validateCustomFieldDefinition(input);
      if (validated.projectId) await requireProject(validated.projectId);
      const [existingField] = await db
        .select({ id: customFields.id })
        .from(customFields)
        .where(
          and(
            tenantScope,
            eq(customFields.key, validated.key),
            validated.projectId ? eq(customFields.projectId, validated.projectId) : isNull(customFields.projectId),
          ),
        )
        .limit(1);
      if (existingField) throw new TenantConflictError("A custom field with this key already exists");

      const [field] = await db
        .insert(customFields)
        .values({
          organizationId,
          workspaceId,
          projectId: validated.projectId ?? null,
          name: validated.name,
          key: validated.key,
          type: validated.type,
          description: validated.description ?? "",
          required: validated.required ?? false,
          sensitive: validated.sensitive ?? false,
          options: validated.options ?? [],
          order: validated.order ?? 10,
          createdById: actorId,
        })
        .returning();
      return field;
    },

    async delete(fieldId: string) {
      await requireWorkspace();
      await requireActor();
      const [field] = await db
        .update(customFields)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(customFields.id, fieldId), tenantScope))
        .returning();
      if (!field) throw new TenantResourceNotFoundError("custom field");
      return field;
    },
  };
}
