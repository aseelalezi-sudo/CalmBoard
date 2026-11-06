import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { ForbiddenException, NotFoundException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { eq } from "drizzle-orm";
import {
  comments,
  createCommentsRepository,
  db,
  idempotencyKeys,
  membershipPermissionOverrides,
  memberships,
  organizations,
  permissions,
  pool,
  projects,
  tasks,
  TenantPermissionDeniedError,
  users,
  workspaces,
  type UpdateCommentInput,
} from "@calmboard/database";
import { CommentsController } from "../src/comments.controller.js";
import { TenantGuard } from "../src/tenant.guard.js";
import { PermissionGuard } from "../src/permission.guard.js";
import { RequestScopeService } from "../src/request-scope.service.js";
import { AuthorizationService } from "../src/authorization.service.js";
import type { AuthenticatedRequest } from "../src/auth.guard.js";

after(() => pool.end());

test(
  "actor-owned comment reactions preserve legacy data, concurrency, authorization and replay safety",
  { timeout: 90_000 },
  async () => {
    const [
      organizationId,
      foreignOrgId,
      workspaceId,
      siblingWorkspaceId,
      foreignWorkspaceId,
      projectId,
      siblingProjectId,
      foreignProjectId,
      taskId,
      siblingTaskId,
      foreignTaskId,
      commentId,
      siblingCommentId,
      foreignCommentId,
    ] = Array.from({ length: 14 }, () => randomUUID());
    const [ownerId, firstId, secondId, viewerId, revokedId, foreignId] = Array.from({ length: 6 }, () => randomUUID());
    const orgIds = [organizationId, foreignOrgId];
    const userIds = [ownerId, firstId, secondId, viewerId, revokedId, foreignId];
    const context = (actorId: string) => ({ organizationId, workspaceId, actorId });
    const repository = (actorId: string) => createCommentsRepository(context(actorId));
    const controller = new CommentsController();
    const tenantGuard = new TenantGuard(new Reflector(), new AuthorizationService(), new RequestScopeService(db));
    const permissionGuard = new PermissionGuard(new Reflector());
    const candidate = (actorId: string, body: Record<string, unknown> = {}) => ({
      method: "POST",
      url: "/comments/reactions",
      query: {},
      params: {},
      auth: { userId: actorId, sessionId: randomUUID() },
      body: { organizationId, workspaceId, id: commentId, emoji: "👍", active: true, ...body },
    });
    const authorize = async (request: ReturnType<typeof candidate>) => {
      const execution = {
        getType: () => "http",
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => CommentsController.prototype.setReaction,
        getClass: () => CommentsController,
      } as unknown as ExecutionContext;
      await tenantGuard.canActivate(execution);
      permissionGuard.canActivate(execution);
    };
    const react = async (actorId: string, body: Record<string, unknown> = {}, key = randomUUID()) => {
      const request = candidate(actorId, body);
      await authorize(request);
      return controller.setReaction(request.body, request as unknown as AuthenticatedRequest, key);
    };

    try {
      await db.insert(users).values(
        userIds.map((id) => ({
          id,
          name: id === firstId || id === secondId ? "Sara" : `Reaction ${id}`,
          email: `reaction-${id}@example.test`,
        })),
      );
      await db.insert(organizations).values([
        { id: organizationId, name: "Reaction test", slug: `reaction-${organizationId}`, ownerId },
        { id: foreignOrgId, name: "Foreign reaction test", slug: `reaction-${foreignOrgId}`, ownerId: foreignId },
      ]);
      await db.insert(workspaces).values([
        { id: workspaceId, organizationId, name: "Reactions", slug: `reaction-${workspaceId}` },
        { id: siblingWorkspaceId, organizationId, name: "Sibling", slug: `reaction-${siblingWorkspaceId}` },
        {
          id: foreignWorkspaceId,
          organizationId: foreignOrgId,
          name: "Foreign",
          slug: `reaction-${foreignWorkspaceId}`,
        },
      ]);
      const membershipRows = await db
        .insert(memberships)
        .values([
          { organizationId, workspaceId, userId: ownerId, role: "owner" as const, status: "active" as const },
          { organizationId, workspaceId, userId: firstId, role: "member" as const, status: "active" as const },
          { organizationId, workspaceId, userId: secondId, role: "member" as const, status: "active" as const },
          { organizationId, workspaceId, userId: viewerId, role: "viewer" as const, status: "active" as const },
          { organizationId, workspaceId, userId: revokedId, role: "member" as const, status: "inactive" as const },
          {
            organizationId: foreignOrgId,
            workspaceId: foreignWorkspaceId,
            userId: foreignId,
            role: "owner" as const,
            status: "active" as const,
          },
        ])
        .returning();
      await db.insert(projects).values([
        { id: projectId, organizationId, workspaceId, name: "Reactions" },
        { id: siblingProjectId, organizationId, workspaceId: siblingWorkspaceId, name: "Sibling" },
        { id: foreignProjectId, organizationId: foreignOrgId, workspaceId: foreignWorkspaceId, name: "Foreign" },
      ]);
      await db.insert(tasks).values([
        {
          id: taskId,
          organizationId,
          workspaceId,
          projectId,
          serial: `REACT-${randomUUID().slice(0, 8)}`,
          title: "Reactions",
        },
        {
          id: siblingTaskId,
          organizationId,
          workspaceId: siblingWorkspaceId,
          projectId: siblingProjectId,
          serial: `REACT-${randomUUID().slice(0, 8)}`,
          title: "Sibling",
        },
        {
          id: foreignTaskId,
          organizationId: foreignOrgId,
          workspaceId: foreignWorkspaceId,
          projectId: foreignProjectId,
          serial: `REACT-${randomUUID().slice(0, 8)}`,
          title: "Foreign",
        },
      ]);
      await db.insert(comments).values([
        {
          id: commentId,
          organizationId,
          workspaceId,
          taskId,
          userId: ownerId,
          content: "Historical reactions",
          reactions: { "👍": ["Sara", firstId], "❤️": ["Historical"] },
        },
        {
          id: siblingCommentId,
          organizationId,
          workspaceId: siblingWorkspaceId,
          taskId: siblingTaskId,
          userId: ownerId,
          content: "Sibling",
        },
        {
          id: foreignCommentId,
          organizationId: foreignOrgId,
          workspaceId: foreignWorkspaceId,
          taskId: foreignTaskId,
          userId: foreignId,
          content: "Foreign",
        },
      ]);

      // Identical names are not identities. Each concurrent add retains both
      // legacy strings verbatim and produces exactly one entry per real actor.
      await Promise.all([
        repository(firstId).setReaction(commentId, "👍", true),
        repository(secondId).setReaction(commentId, "👍", true),
      ]);
      for (let repeat = 0; repeat < 3; repeat++) {
        await Promise.all([
          repository(firstId).setReaction(commentId, "👍", true),
          repository(secondId).setReaction(commentId, "👍", true),
        ]);
      }
      let [visible] = await repository(ownerId).listByTask(taskId);
      assert.deepEqual(visible.reactions["👍"], ["Sara", firstId]);
      assert.deepEqual(new Set(visible.reactionUserIds["👍"]), new Set([firstId, secondId]));
      assert.equal(visible.reactionUserIds["👍"].length, 2);
      assert.deepEqual(visible.reactions["❤️"], ["Historical"]);

      await Promise.all([
        repository(firstId).setReaction(commentId, "👍", false),
        repository(secondId).setReaction(commentId, "🚀", true),
      ]);
      [visible] = await repository(ownerId).listByTask(taskId);
      assert.deepEqual(visible.reactionUserIds["👍"], [secondId]);
      assert.deepEqual(visible.reactionUserIds["🚀"], [secondId]);
      assert.deepEqual(visible.reactions["👍"], ["Sara", firstId]);
      await db.update(users).set({ name: "Renamed" }).where(eq(users.id, secondId));
      assert.deepEqual((await repository(ownerId).listByTask(taskId))[0].reactionUserIds["👍"], [secondId]);

      // The controller derives ownership from authenticated identity, including
      // when invoked without relying on TenantGuard rewriting the body.
      const key = randomUUID();
      const forged = {
        organizationId,
        workspaceId,
        id: commentId,
        emoji: "👍",
        active: true,
        actorId: secondId,
        userId: secondId,
      };
      const auth = { auth: { userId: firstId, sessionId: randomUUID() } } as AuthenticatedRequest;
      const first = await controller.setReaction(forged, auth, key);
      assert.ok(first.reactionUserIds["👍"].includes(firstId));
      await repository(firstId).setReaction(commentId, "👍", false);
      await controller.setReaction(forged, auth, key);
      assert.deepEqual(
        (await repository(ownerId).listByTask(taskId))[0].reactionUserIds["👍"],
        [secondId],
        "replaying an earlier successful add must not execute it again",
      );
      const keyRows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key));
      assert.equal(keyRows[0].actorId, firstId);
      await assert.rejects(controller.setReaction({ ...forged, active: false }, auth, key), /different request/);
      await assert.rejects(
        controller.setReaction(
          forged,
          { auth: { userId: secondId, sessionId: randomUUID() } } as AuthenticatedRequest,
          key,
        ),
        /different request/,
      );

      for (const actorId of [viewerId, revokedId, foreignId]) {
        await assert.rejects(react(actorId), ForbiddenException);
        await assert.rejects(repository(actorId).setReaction(commentId, "👍", true), TenantPermissionDeniedError);
      }
      for (const id of [siblingCommentId, foreignCommentId, randomUUID()]) {
        await assert.rejects(react(ownerId, { id }), NotFoundException);
        await assert.rejects(repository(ownerId).setReaction(id, "👍", true), /not found/);
      }
      await assert.rejects(react(ownerId, { projectId: siblingProjectId }), ForbiddenException);
      await assert.rejects(
        repository(ownerId).update(commentId, { reactions: { "👍": [secondId] } } as unknown as UpdateCommentInput),
        TenantPermissionDeniedError,
      );
      await assert.rejects(
        repository(firstId).update(commentId, { mentionedUserIds: [secondId] }),
        TenantPermissionDeniedError,
      );

      const [permission] = await db.select().from(permissions).where(eq(permissions.key, "comments.manage"));
      assert.ok(permission);
      await db.insert(membershipPermissionOverrides).values({
        organizationId,
        workspaceId,
        projectId,
        membershipId: membershipRows.find((item) => item.userId === firstId)!.id,
        permissionId: permission.id,
        scope: "project",
        effect: "deny",
        createdBy: ownerId,
      });
      await assert.rejects(react(firstId), ForbiddenException);
      await assert.rejects(repository(firstId).setReaction(commentId, "👍", true), TenantPermissionDeniedError);

      await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
      await assert.rejects(react(ownerId), NotFoundException);
    } finally {
      for (const table of [
        "idempotency_keys",
        "comments",
        "tasks",
        "membership_permission_overrides",
        "memberships",
        "projects",
        "usage_limits",
        "subscriptions",
        "workspaces",
      ]) {
        await pool.query(`delete from ${table} where organization_id = any($1::uuid[])`, [orgIds]);
      }
      await pool.query("update organizations set owner_id = null where id = any($1::uuid[])", [orgIds]);
      await pool.query("delete from organizations where id = any($1::uuid[])", [orgIds]);
      await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
    }
  },
);
