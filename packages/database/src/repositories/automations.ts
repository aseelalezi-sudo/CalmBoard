import { and, desc, eq, inArray, isNull, not, notExists, or, sql } from "drizzle-orm";
import { db } from "../client.js";
import { accessibleProjectIds } from "../project-access.js";
import { assertExportProjectAccess } from "../export-access.js";
import { TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { automationRuns, automations, memberships, tasks, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type AutomationRecord = typeof automations.$inferSelect;
export type CreateAutomationInput = Pick<AutomationRecord, "name" | "trigger"> &
  Partial<Pick<AutomationRecord, "conditions" | "actions" | "enabled">>;
export type UpdateAutomationInput = Partial<
  Pick<AutomationRecord, "name" | "trigger" | "conditions" | "actions" | "enabled">
>;
export type CreateAutomationRunInput = {
  automationId: string;
  eventId?: string | null;
  taskId?: string | null;
  status: "success" | "failed" | "skipped";
  attempt?: number;
  claimToken?: string | null;
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

  async function requireMember() {
    if (!actorId) throw new TenantPermissionDeniedError("actorId is required to access automations");
    const [membership] = await db
      .select({ id: memberships.id })
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
    if (!membership) throw new TenantPermissionDeniedError("automation access requires active membership");
  }

  return {
    async list() {
      await requireWorkspace();
      await requireMember();
      const projectIds = await accessibleProjectIds(context, true);
      const visibleTasks = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.organizationId, organizationId),
            eq(tasks.workspaceId, workspaceId),
            inArray(tasks.projectId, projectIds),
          ),
        );
      let allowUnscoped = false;
      try {
        await assertExportProjectAccess(context, false);
        allowUnscoped = true;
      } catch (error) {
        if (!(error instanceof TenantPermissionDeniedError)) throw error;
      }
      const visibleRun = sql<boolean>`coalesce(${or(
        inArray(automationRuns.taskId, visibleTasks),
        allowUnscoped ? isNull(automationRuns.taskId) : undefined,
      )}, false)`;
      // Rule totals and timestamps include all executions. Keep them together
      // with their audit history when a private execution is hidden.
      const rules = await db
        .select()
        .from(automations)
        .where(
          and(
            workspaceScope,
            or(
              sql`${automations.conditions}->>'projectId' is null`,
              inArray(sql<string>`${automations.conditions}->>'projectId'`, projectIds),
            ),
            notExists(
              db
                .select({ id: automationRuns.id })
                .from(automationRuns)
                .where(and(runScope, eq(automationRuns.automationId, automations.id), not(visibleRun))),
            ),
          ),
        )
        .orderBy(desc(automations.createdAt));
      const automationIds = rules.map((rule) => rule.id);
      const runs = automationIds.length
        ? await db
            .select()
            .from(automationRuns)
            .where(and(inArray(automationRuns.automationId, automationIds), runScope, visibleRun))
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
          eventId: input.eventId ?? null,
          taskId: input.taskId ?? null,
          status: input.status,
          attempt: input.attempt ?? 1,
          claimToken: input.claimToken ?? null,
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
