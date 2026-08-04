import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, withTenantTransaction } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import {
  formResponses,
  forms,
  projects,
  workspaces,
  type FormSettings,
  type FormTaskCreationPayload,
} from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type {
  FormConditionOperator,
  FormFieldCondition,
  FormFieldDefinition,
  FormFieldType,
  FormSettings,
} from "../schema.js";

export type CreateFormInput = Omit<typeof forms.$inferInsert, "organizationId" | "workspaceId">;
export type UpdateFormInput = Partial<
  Pick<typeof forms.$inferInsert, "name" | "description" | "fields" | "settings" | "isActive" | "projectId">
>;

async function readFormWithTenant(formId: string) {
  const [record] = await db
    .select({ form: forms, workspace: workspaces })
    .from(forms)
    .innerJoin(workspaces, eq(forms.workspaceId, workspaces.id))
    .where(and(eq(forms.id, formId), isNull(forms.deletedAt)))
    .limit(1);
  if (!record) throw new TenantResourceNotFoundError("form");
  return record;
}

export function createFormsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId } = context;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireForm(formId: string) {
    const record = await readFormWithTenant(formId);
    if (record.workspace.id !== workspaceId || record.workspace.organizationId !== organizationId) {
      throw new TenantResourceNotFoundError("form");
    }
    return record.form;
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

  return {
    async list() {
      await requireWorkspace();
      return db
        .select()
        .from(forms)
        .where(
          and(eq(forms.organizationId, organizationId), eq(forms.workspaceId, workspaceId), isNull(forms.deletedAt)),
        )
        .orderBy(desc(forms.createdAt));
    },
    async create(input: CreateFormInput) {
      await requireWorkspace();
      if (input.projectId) await requireProject(input.projectId);
      const [form] = await db
        .insert(forms)
        .values({ ...input, organizationId, workspaceId })
        .returning();
      return form;
    },
    async update(formId: string, input: UpdateFormInput) {
      await requireForm(formId);
      if (input.projectId) await requireProject(input.projectId);
      const [form] = await db
        .update(forms)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(forms.id, formId),
            eq(forms.organizationId, organizationId),
            eq(forms.workspaceId, workspaceId),
            isNull(forms.deletedAt),
          ),
        )
        .returning();
      if (!form) throw new TenantResourceNotFoundError("form");
      return form;
    },
    async getWithResponses(formId: string) {
      const form = await requireForm(formId);
      const responses = await db
        .select()
        .from(formResponses)
        .where(
          and(
            eq(formResponses.formId, formId),
            eq(formResponses.organizationId, organizationId),
            eq(formResponses.workspaceId, workspaceId),
          ),
        )
        .orderBy(desc(formResponses.submittedAt))
        .limit(50);
      return { form, responses };
    },
  };
}

export function createPublicFormsRepository() {
  async function resolveTenant(formId: string) {
    const result = await db.execute<{ organization_id: string; workspace_id: string }>(sql`
      select organization_id, workspace_id
      from public.resolve_public_form_tenant(${formId}::uuid)
    `);
    const tenant = result.rows[0];
    if (!tenant) throw new TenantResourceNotFoundError("form");
    return { organizationId: tenant.organization_id, workspaceId: tenant.workspace_id };
  }

  return {
    async get(formId: string) {
      const context = await resolveTenant(formId);
      return withTenantTransaction(context, async () => {
        const { form } = await readFormWithTenant(formId);
        return {
          id: form.id,
          name: form.name,
          description: form.description,
          fields: form.fields,
          settings: form.settings,
          isActive: form.isActive,
        };
      });
    },
    async submit(formId: string, data: Record<string, string>) {
      const context = await resolveTenant(formId);
      return withTenantTransaction(context, async () => {
        const { form, workspace } = await readFormWithTenant(formId);
        const settings = (form.settings ?? {}) as FormSettings;
        let taskCreationPayload: FormTaskCreationPayload | null = null;
        if (settings.createTask === true && form.projectId) {
          const titleFieldId = settings.taskTitleFieldId || "f1";
          const descriptionFieldId = settings.taskDescriptionFieldId || "f2";
          taskCreationPayload = {
            projectId: form.projectId,
            title: `[${form.name}] ${String(data[titleFieldId] || data.title || form.name).slice(0, 120)}`,
            description: String(data[descriptionFieldId] || data.details || ""),
            status: ["backlog", "todo", "in_progress", "review"].includes(String(settings.status))
              ? settings.status
              : "todo",
            priority: ["low", "medium", "high", "urgent"].includes(String(settings.priority))
              ? settings.priority
              : "medium",
          };
        }
        const [response] = await db
          .insert(formResponses)
          .values({
            organizationId: workspace.organizationId,
            workspaceId: workspace.id,
            formId,
            data,
            taskCreationPayload,
            taskCreationStatus: taskCreationPayload ? "pending" : "not_requested",
          })
          .returning();
        await db
          .update(forms)
          .set({ responses: sql`${forms.responses} + 1`, updatedAt: new Date() })
          .where(and(eq(forms.id, formId), isNull(forms.deletedAt)));
        return {
          responseId: response.id,
          taskCreationStatus: response.taskCreationStatus,
        };
      });
    },
  };
}
