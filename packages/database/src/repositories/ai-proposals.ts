import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../client.js";
import { aiActionProposals, projects, type AIProposedTask } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export const AI_PROPOSAL_TTL_MS = 15 * 60 * 1_000;

export class AIProposalNotAvailableError extends Error {
  constructor() {
    super("AI proposal is not available");
    this.name = "AIProposalNotAvailableError";
  }
}

export class AIProposalExpiredError extends Error {
  constructor() {
    super("AI proposal has expired");
    this.name = "AIProposalExpiredError";
  }
}

export class AIProposalDigestMismatchError extends Error {
  constructor() {
    super("AI proposal content does not match the reviewed content");
    this.name = "AIProposalDigestMismatchError";
  }
}

export type AIActionProposalView = {
  id: string;
  projectId: string;
  digest: string;
  expiresAt: string;
  kind: "create_tasks";
  tasks: AIProposedTask[];
};

function proposalContext(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  if (!context.actorId) throw new Error("actorId is required for AI proposals");
  return context as DatabaseTenantContext & { workspaceId: string; actorId: string };
}

function normalizeTasks(tasks: AIProposedTask[]) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 50) {
    throw new Error("AI proposal must contain between 1 and 50 tasks");
  }
  const priorities = new Set<AIProposedTask["priority"]>(["low", "medium", "high", "urgent"]);
  return tasks.map((task) => {
    const title = task.title.trim();
    const description = task.description.trim();
    if (!title || title.length > 200) throw new Error("AI proposal task title is invalid");
    if (description.length > 10_000) throw new Error("AI proposal task description is invalid");
    if (!priorities.has(task.priority)) throw new Error("AI proposal task priority is invalid");
    if (
      task.estimatedHours !== undefined &&
      (!Number.isFinite(task.estimatedHours) || task.estimatedHours < 0 || task.estimatedHours > 100_000)
    ) {
      throw new Error("AI proposal task estimate is invalid");
    }
    return {
      title,
      description,
      priority: task.priority,
      ...(task.estimatedHours === undefined ? {} : { estimatedHours: task.estimatedHours }),
    } satisfies AIProposedTask;
  });
}

function digestPayload(tasks: AIProposedTask[]) {
  return createHash("sha256").update(JSON.stringify(tasks)).digest("hex");
}

function proposalView(row: typeof aiActionProposals.$inferSelect): AIActionProposalView {
  return {
    id: row.id,
    projectId: row.projectId,
    digest: row.payloadDigest,
    expiresAt: row.expiresAt.toISOString(),
    kind: "create_tasks",
    tasks: row.payload,
  };
}

export function createAIProposalsRepository(context: DatabaseTenantContext) {
  const tenant = proposalContext(context);

  async function lockPending(id: string, projectId: string) {
    const [proposal] = await db
      .select()
      .from(aiActionProposals)
      .where(
        and(
          eq(aiActionProposals.id, id),
          eq(aiActionProposals.organizationId, tenant.organizationId),
          eq(aiActionProposals.workspaceId, tenant.workspaceId),
          eq(aiActionProposals.actorId, tenant.actorId),
          eq(aiActionProposals.projectId, projectId),
          eq(aiActionProposals.status, "pending"),
        ),
      )
      .for("update")
      .limit(1);
    if (!proposal) throw new AIProposalNotAvailableError();
    return proposal;
  }

  async function verifyDigestAndExpiry(proposal: typeof aiActionProposals.$inferSelect, digest: string) {
    if (proposal.payloadDigest !== digest) throw new AIProposalDigestMismatchError();
    if (proposal.expiresAt.getTime() <= Date.now()) throw new AIProposalExpiredError();
  }

  return {
    async create(input: {
      projectId: string;
      action: string;
      tasks: AIProposedTask[];
      provider: string;
      model: string;
    }): Promise<AIActionProposalView> {
      const normalizedTasks = normalizeTasks(input.tasks);
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, tenant.organizationId),
            eq(projects.workspaceId, tenant.workspaceId),
          ),
        )
        .limit(1);
      if (!project) throw new AIProposalNotAvailableError();
      const [proposal] = await db
        .insert(aiActionProposals)
        .values({
          organizationId: tenant.organizationId,
          workspaceId: tenant.workspaceId,
          projectId: project.id,
          actorId: tenant.actorId,
          action: input.action,
          payload: normalizedTasks,
          payloadDigest: digestPayload(normalizedTasks),
          provider: input.provider,
          model: input.model,
          expiresAt: new Date(Date.now() + AI_PROPOSAL_TTL_MS),
        })
        .returning();
      if (!proposal) throw new Error("AI proposal could not be created");
      return proposalView(proposal);
    },

    async execute<T>(
      id: string,
      digest: string,
      projectId: string,
      operation: (proposal: { projectId: string; tasks: AIProposedTask[] }) => Promise<T>,
    ): Promise<T> {
      const proposal = await lockPending(id, projectId);
      await verifyDigestAndExpiry(proposal, digest);
      const result = await operation({ projectId: proposal.projectId, tasks: proposal.payload });
      const now = new Date();
      await db
        .update(aiActionProposals)
        .set({ status: "executed", approvedAt: now, executedAt: now, updatedAt: now })
        .where(eq(aiActionProposals.id, proposal.id));
      return result;
    },

    async reject(id: string, digest: string, projectId: string) {
      const proposal = await lockPending(id, projectId);
      await verifyDigestAndExpiry(proposal, digest);
      const now = new Date();
      await db
        .update(aiActionProposals)
        .set({ status: "rejected", rejectedAt: now, updatedAt: now })
        .where(eq(aiActionProposals.id, proposal.id));
      return { id: proposal.id, status: "rejected" as const };
    },
  };
}
