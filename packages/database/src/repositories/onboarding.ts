import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantPermissionDeniedError } from "../errors.js";
import { invitations, memberships, projects, tasks, userOnboardingProgress, workspaces } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export const onboardingSteps = [
  "workspace_ready",
  "project_created",
  "task_created",
  "teammate_invited",
  "board_explored",
] as const;
export type OnboardingStep = (typeof onboardingSteps)[number];

function normalizedSteps(value: string[]) {
  const allowed = new Set<string>(onboardingSteps);
  if (value.some((step) => !allowed.has(step))) {
    throw new TenantPermissionDeniedError("Onboarding steps must use the server allow-list");
  }
  return [...new Set(value)] as OnboardingStep[];
}

export function createOnboardingRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const organizationId = context.organizationId;
  const workspaceId = context.workspaceId;

  function requireSelf(userId: string) {
    if (!context.actorId || context.actorId !== userId) {
      throw new TenantPermissionDeniedError("Users may update only their own onboarding progress");
    }
  }

  async function derivedSteps(userId: string) {
    const [membership] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.organizationId, memberships.organizationId))
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(memberships.userId, userId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
      .limit(1);
    const [invitation] = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.organizationId, organizationId), eq(invitations.workspaceId, workspaceId)))
      .limit(1);
    return [
      ...(membership ? (["workspace_ready"] as const) : []),
      ...(project ? (["project_created"] as const) : []),
      ...(task ? (["task_created"] as const) : []),
      ...(invitation ? (["teammate_invited"] as const) : []),
    ];
  }

  return {
    async get(userId: string) {
      requireSelf(userId);
      const [stored] = await db
        .select()
        .from(userOnboardingProgress)
        .where(
          and(
            eq(userOnboardingProgress.organizationId, organizationId),
            eq(userOnboardingProgress.workspaceId, workspaceId),
            eq(userOnboardingProgress.userId, userId),
          ),
        )
        .limit(1);
      const completedSteps = normalizedSteps([...(stored?.completedSteps ?? []), ...(await derivedSteps(userId))]);
      return {
        id: stored?.id ?? null,
        organizationId,
        workspaceId,
        userId,
        completedSteps,
        dismissedAt: stored?.dismissedAt ?? null,
        completedAt: stored?.completedAt ?? (completedSteps.length === onboardingSteps.length ? new Date() : null),
        updatedAt: stored?.updatedAt ?? null,
      };
    },

    async update(userId: string, input: { completedSteps?: string[]; dismissed?: boolean }) {
      requireSelf(userId);
      const current = await this.get(userId);
      const completedSteps = normalizedSteps(input.completedSteps ?? current.completedSteps);
      const now = new Date();
      const [progress] = await db
        .insert(userOnboardingProgress)
        .values({
          organizationId,
          workspaceId,
          userId,
          completedSteps,
          dismissedAt: input.dismissed === true ? now : null,
          completedAt: completedSteps.length === onboardingSteps.length ? now : null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userOnboardingProgress.userId, userOnboardingProgress.workspaceId],
          set: {
            completedSteps,
            ...(input.dismissed === undefined ? {} : { dismissedAt: input.dismissed ? now : null }),
            completedAt: completedSteps.length === onboardingSteps.length ? now : null,
            updatedAt: now,
          },
        })
        .returning();
      return progress;
    },
  };
}
