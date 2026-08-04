import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { automationRuns, automations, memberships, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type AutomationRecord = typeof automations.$inferSelect;
export type CreateAutomationInput = Pick<AutomationRecord, "name" | "trigger"> &
  Partial<Pick<AutomationRecord, "conditions" | "actions" | "enabled">>;
export type UpdateAutomationInput = Partial<
  Pick<AutomationRecord, "name" | "trigger" | "conditions" | "actions" | "enabled">
>;
export type CreateAutomationRunInput = {
  automationId: string;
  taskId?: string | null;
  status: "success" | "failed" | "skipped";
  message?: string;
  durationMs?: number;
};

export function createAutomationsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const { organizationId, workspaceId, actorId } = context;
  const workspaceScope = and(
    eq(automations.organizationId, organizationId),
    eq(automations.workspaceId, workspaceId),
    isNull(automations.deletedAt),
  )!;
  const runScope = and(eq(automationRuns.organizationId, organizationId), eq(automationRuns.workspaceId, workspaceId))!;

  async function requireWorkspace() {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.organizationId, organizationId)))
      .limit(1);
    if (!workspace) throw new TenantResourceNotFoundError("workspace");
  }

  async function requireAutomation(automationId: string) {
    const [automation] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.id, automationId), workspaceScope))
      .limit(1);
    if (!automation) throw new TenantResourceNotFoundError("automation");
    return automation;
  }

  async function requireManager() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required to manage automations");
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          inArray(memberships.role, ["owner", "admin", "manager"]),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError("automation management requires manager access");
  }

  return {
    async list() {
      await requireWorkspace();
      const rules = await db.select().from(automations).where(workspaceScope).orderBy(desc(automations.createdAt));
      const automationIds = rules.map((rule) => rule.id);
      const runs = automationIds.length
        ? await db
            .select()
            .from(automationRuns)
            .where(and(inArray(automationRuns.automationId, automationIds), runScope))
            .orderBy(desc(automationRuns.createdAt))
            .limit(30)
        : [];
      return { automations: rules, runs };
    },

    async listEnabled(trigger?: string) {
      await requireWorkspace();
      const conditions = [workspaceScope, eq(automations.enabled, true)];
      if (trigger) conditions.push(eq(automations.trigger, trigger));
      return db
        .select()
        .from(automations)
        .where(and(...conditions));
    },

    async create(input: CreateAutomationInput) {
      await requireWorkspace();
      await requireManager();
      const [automation] = await db
        .insert(automations)
        .values({
          organizationId,
          workspaceId,
          name: input.name,
          trigger: input.trigger,
          conditions: input.conditions ?? {},
          actions: input.actions ?? {},
          enabled: input.enabled ?? true,
        })
        .returning();
      return automation;
    },

    async update(automationId: string, input: UpdateAutomationInput) {
      await requireWorkspace();
      await requireManager();
      const [automation] = await db
        .update(automations)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(automations.id, automationId), workspaceScope))
        .returning();
      if (!automation) throw new TenantResourceNotFoundError("automation");
      return automation;
    },

    async recordRun(input: CreateAutomationRunInput) {
      await requireAutomation(input.automationId);
      const [run] = await db
        .insert(automationRuns)
        .values({
          organizationId,
          workspaceId,
          automationId: input.automationId,
          taskId: input.taskId ?? null,
          status: input.status,
          message: input.message,
          durationMs: input.durationMs ?? 0,
        })
        .returning();
      return run;
    },

    async markExecuted(automationId: string) {
      await requireAutomation(automationId);
      await db
        .update(automations)
        .set({
          runs: sql`${automations.runs} + 1`,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(automations.id, automationId), workspaceScope));
    },
  };
}
