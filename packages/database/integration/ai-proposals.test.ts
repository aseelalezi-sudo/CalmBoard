import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  AIProposalDigestMismatchError,
  AIProposalExpiredError,
  AIProposalNotAvailableError,
  aiActionProposals,
  createAIProposalsRepository,
  db,
  memberships,
  organizations,
  pool,
  projects,
  users,
  withDatabaseContext,
  workspaces,
  type DatabaseTenantContext,
} from "../src/index";

after(async () => {
  await pool.end();
});

async function fixture() {
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  await db.insert(users).values([
    { id: actorId, name: "AI proposal owner", email: `ai-proposal-${actorId}@example.test` },
    { id: otherActorId, name: "Other actor", email: `ai-proposal-${otherActorId}@example.test` },
  ]);
  await db.insert(organizations).values({
    id: organizationId,
    name: "AI proposal organization",
    slug: `ai-proposal-${organizationId}`,
    ownerId: actorId,
    plan: "team",
    seats: 2,
  });
  await db.insert(workspaces).values({ id: workspaceId, organizationId, name: "AI workspace", slug: workspaceId });
  await db
    .insert(memberships)
    .values(
      [actorId, otherActorId].map((userId) => ({ organizationId, workspaceId, userId, status: "active" as const })),
    );
  await db
    .insert(projects)
    .values({ id: projectId, organizationId, workspaceId, name: "AI project", ownerId: actorId });
  return {
    context: { organizationId, workspaceId, actorId } satisfies DatabaseTenantContext,
    otherContext: { organizationId, workspaceId, actorId: otherActorId } satisfies DatabaseTenantContext,
    projectId,
    otherActorId,
  };
}

describe("AI action proposal approval", () => {
  it("binds reviewed content to tenant and actor and executes it at most once", async () => {
    const { context, otherContext, projectId, otherActorId } = await fixture();
    try {
      const proposal = await withDatabaseContext(context, () =>
        createAIProposalsRepository(context).create({
          projectId,
          action: "breakdown",
          tasks: [{ title: "Reviewed task", description: "Safe payload", priority: "high" }],
          provider: "openai",
          model: "integration-model",
        }),
      );
      assert.match(proposal.digest, /^[a-f0-9]{64}$/);
      assert.equal(proposal.tasks.length, 1);

      await assert.rejects(
        () =>
          withDatabaseContext(otherContext, () =>
            createAIProposalsRepository(otherContext).reject(proposal.id, proposal.digest, projectId),
          ),
        AIProposalNotAvailableError,
      );
      await assert.rejects(
        () =>
          withDatabaseContext(context, () =>
            createAIProposalsRepository(context).execute(proposal.id, "b".repeat(64), projectId, async () => undefined),
          ),
        AIProposalDigestMismatchError,
      );
      await assert.rejects(
        () =>
          withDatabaseContext(context, () =>
            createAIProposalsRepository(context).execute(
              proposal.id,
              proposal.digest,
              randomUUID(),
              async () => undefined,
            ),
          ),
        AIProposalNotAvailableError,
      );

      let executions = 0;
      const attempts = await Promise.allSettled(
        [1, 2].map(() =>
          withDatabaseContext(context, () =>
            createAIProposalsRepository(context).execute(proposal.id, proposal.digest, projectId, async ({ tasks }) => {
              executions += 1;
              assert.equal(tasks[0]?.title, "Reviewed task");
              await new Promise((resolve) => setTimeout(resolve, 25));
              return tasks.length;
            }),
          ),
        ),
      );
      assert.equal(executions, 1);
      assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
      assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);

      const [stored] = await withDatabaseContext(context, () =>
        db.select().from(aiActionProposals).where(eq(aiActionProposals.id, proposal.id)),
      );
      assert.equal(stored?.status, "executed");
      assert.ok(stored?.approvedAt);
      assert.ok(stored?.executedAt);

      const expired = await withDatabaseContext(context, () =>
        createAIProposalsRepository(context).create({
          projectId,
          action: "generate_task",
          tasks: [{ title: "Expired task", description: "", priority: "medium" }],
          provider: "openai",
          model: "integration-model",
        }),
      );
      await withDatabaseContext(context, () =>
        db
          .update(aiActionProposals)
          .set({ createdAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1_000) })
          .where(eq(aiActionProposals.id, expired.id)),
      );
      await assert.rejects(
        () =>
          withDatabaseContext(context, () =>
            createAIProposalsRepository(context).execute(expired.id, expired.digest, projectId, async () => undefined),
          ),
        AIProposalExpiredError,
      );
    } finally {
      await db
        .delete(organizations)
        .where(eq(organizations.id, context.organizationId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, otherActorId))
        .catch(() => undefined);
      await db
        .delete(users)
        .where(eq(users.id, context.actorId!))
        .catch(() => undefined);
    }
  });
});
