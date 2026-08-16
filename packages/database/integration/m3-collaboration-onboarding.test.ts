import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";

process.env.AUTH_EMAIL_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

import { decryptInvitationEmailPayload } from "@calmboard/notifications";
import { and, eq } from "drizzle-orm";
import {
  acceptInvitation,
  commentMentions,
  comments,
  createCommentsRepository,
  createMembershipsRepository,
  createOnboardingRepository,
  db,
  declineInvitation,
  effectiveInvitationStatus,
  hashInvitationToken,
  inspectInvitation,
  invitationEmailOutbox,
  invitations,
  memberships,
  notifications,
  organizations,
  pool,
  projects,
  tasks,
  TenantConflictError,
  TenantPermissionDeniedError,
  TenantResourceNotFoundError,
  userOnboardingProgress,
  users,
  workspaces,
} from "../src/index.js";

after(async () => {
  await pool.end();
});

function invitationToken(row: typeof invitationEmailOutbox.$inferSelect) {
  assert.ok(row.encryptedPayload);
  assert.ok(row.initializationVector);
  assert.ok(row.authenticationTag);
  const payload = decryptInvitationEmailPayload(
    {
      id: row.id,
      organizationId: row.organizationId,
      workspaceId: row.workspaceId,
      invitationId: row.invitationId,
      tokenVersion: row.tokenVersion,
    },
    {
      encryptedPayload: row.encryptedPayload,
      initializationVector: row.initializationVector,
      authenticationTag: row.authenticationTag,
      encryptionAlgorithm: "aes-256-gcm",
      encryptionKeyVersion: row.encryptionKeyVersion,
    },
  );
  const match = /[?&]token=([^"&<]+)/.exec(payload.html);
  assert.ok(match?.[1], "encrypted invitation email must contain its acceptance token");
  return decodeURIComponent(match[1]);
}

async function expectUniqueViolation(operation: () => Promise<unknown>) {
  await assert.rejects(operation, (error: unknown) => {
    let current: unknown = error;
    while (typeof current === "object" && current !== null) {
      if ("code" in current && current.code === "23505") return true;
      current = "cause" in current ? current.cause : null;
    }
    return false;
  });
}

function hasDatabaseCode(error: unknown, code: string) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ("code" in current && current.code === code) return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

describe("M3 collaboration and onboarding", () => {
  it("enforces secure invitations, mention/reply integrity, deduplication, and self-owned onboarding", async () => {
    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const taskId = randomUUID();
    const secondTaskId = randomUUID();
    const otherTaskId = randomUUID();
    const ownerId = randomUUID();
    const inviteeId = randomUUID();
    const mentionedId = randomUUID();
    const outsiderId = randomUUID();
    const expiredUserId = randomUUID();
    const declinedUserId = randomUUID();
    const restrictedRole = `calmboard_m3_rls_${randomUUID().replaceAll("-", "")}`;
    const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
    let roleCreated = false;
    const invitationEmails = {
      invitee: `invitee-${inviteeId}@example.test`,
      legacy: `legacy-${randomUUID()}@example.test`,
      expired: `expired-${expiredUserId}@example.test`,
      declined: `declined-${declinedUserId}@example.test`,
    };

    try {
      await db.insert(users).values([
        { id: ownerId, email: `owner-${ownerId}@example.test`, name: "Owner" },
        { id: inviteeId, email: invitationEmails.invitee, name: "Invitee" },
        { id: mentionedId, email: `mentioned-${mentionedId}@example.test`, name: "Mentioned Member" },
        { id: outsiderId, email: `outsider-${outsiderId}@example.test`, name: "Outsider" },
        { id: expiredUserId, email: invitationEmails.expired, name: "Expired Invitee" },
        { id: declinedUserId, email: invitationEmails.declined, name: "Declined Invitee" },
      ]);
      await db.insert(organizations).values([
        {
          id: organizationId,
          name: "M3 tenant",
          slug: `m3-${organizationId}`,
          ownerId,
        },
        {
          id: otherOrganizationId,
          name: "M3 other tenant",
          slug: `m3-other-${otherOrganizationId}`,
          ownerId: outsiderId,
        },
      ]);
      await db.insert(workspaces).values([
        {
          id: workspaceId,
          organizationId,
          name: "M3 workspace",
          slug: `m3-${workspaceId}`,
        },
        {
          id: otherWorkspaceId,
          organizationId: otherOrganizationId,
          name: "M3 other workspace",
          slug: `m3-other-${otherWorkspaceId}`,
        },
      ]);
      await db.insert(memberships).values([
        { organizationId, workspaceId, userId: ownerId, role: "owner", status: "active" },
        { organizationId, workspaceId, userId: mentionedId, role: "member", status: "active" },
        {
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          userId: outsiderId,
          role: "owner",
          status: "active",
        },
      ]);
      await db.insert(projects).values([
        { id: projectId, organizationId, workspaceId, name: "M3 project" },
        {
          id: otherProjectId,
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          name: "Other project",
        },
      ]);
      await db.insert(tasks).values([
        { id: taskId, organizationId, workspaceId, projectId, serial: `M3-${taskId.slice(0, 8)}`, title: "M3 task" },
        {
          id: secondTaskId,
          organizationId,
          workspaceId,
          projectId,
          serial: `M3-${secondTaskId.slice(0, 8)}`,
          title: "Second task",
        },
        {
          id: otherTaskId,
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          projectId: otherProjectId,
          serial: `M3-${otherTaskId.slice(0, 8)}`,
          title: "Other task",
        },
      ]);

      const membershipRepository = createMembershipsRepository({ organizationId, workspaceId, actorId: ownerId });
      const created = await membershipRepository.invite({ email: invitationEmails.invitee, role: "member" });
      assert.equal(created.immediate, false);
      assert.equal(created.invitation.tokenVersion, 1);
      assert.ok(created.invitation.tokenHash);
      assert.ok(created.invitation.expiresAt);
      const [firstOutbox] = await db
        .select()
        .from(invitationEmailOutbox)
        .where(eq(invitationEmailOutbox.invitationId, created.invitation.id));
      assert.ok(firstOutbox);
      const firstToken = invitationToken(firstOutbox);
      assert.equal(created.invitation.tokenHash, hashInvitationToken(firstToken));
      assert.equal(
        JSON.stringify(firstOutbox).includes(firstToken),
        false,
        "outbox row must not expose plaintext token",
      );
      assert.equal((await inspectInvitation(firstToken)).status, "pending");

      const resent = await membershipRepository.resend(created.invitation.id);
      assert.equal(resent.tokenVersion, 2);
      const [secondOutbox] = await db
        .select()
        .from(invitationEmailOutbox)
        .where(
          and(eq(invitationEmailOutbox.invitationId, created.invitation.id), eq(invitationEmailOutbox.tokenVersion, 2)),
        );
      assert.ok(secondOutbox);
      const currentToken = invitationToken(secondOutbox);
      assert.notEqual(currentToken, firstToken);
      assert.equal((await inspectInvitation(firstToken)).status, "invalid");
      assert.equal((await inspectInvitation(currentToken)).status, "pending");
      await assert.rejects(
        () => acceptInvitation(currentToken, outsiderId),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );

      const acceptanceResults = await Promise.allSettled([
        acceptInvitation(currentToken, inviteeId),
        acceptInvitation(currentToken, inviteeId),
      ]);
      assert.equal(acceptanceResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(acceptanceResults.filter((result) => result.status === "rejected").length, 1);
      assert.equal(
        (
          await db
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.workspaceId, workspaceId),
                eq(memberships.userId, inviteeId),
              ),
            )
        ).length,
        1,
      );
      assert.equal((await inspectInvitation(currentToken)).status, "accepted");

      const [legacyInvitation] = await db
        .insert(invitations)
        .values({ organizationId, workspaceId, email: invitationEmails.legacy, role: "viewer", invitedBy: ownerId })
        .returning();
      assert.ok(legacyInvitation);
      assert.equal(effectiveInvitationStatus(legacyInvitation), "resend_required");
      const legacyResent = await membershipRepository.resend(legacyInvitation.id);
      assert.equal(legacyResent.tokenVersion, 1);
      const [legacyOutbox] = await db
        .select()
        .from(invitationEmailOutbox)
        .where(eq(invitationEmailOutbox.invitationId, legacyInvitation.id));
      assert.ok(legacyOutbox);
      const legacyToken = invitationToken(legacyOutbox);
      await membershipRepository.revoke(legacyInvitation.id);
      assert.equal((await inspectInvitation(legacyToken)).status, "revoked");

      const expired = await membershipRepository.invite({ email: invitationEmails.expired });
      const [expiredOutbox] = await db
        .select()
        .from(invitationEmailOutbox)
        .where(eq(invitationEmailOutbox.invitationId, expired.invitation.id));
      assert.ok(expiredOutbox);
      const expiredToken = invitationToken(expiredOutbox);
      await db
        .update(invitations)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(invitations.id, expired.invitation.id));
      assert.equal((await inspectInvitation(expiredToken)).status, "expired");
      await assert.rejects(
        () => acceptInvitation(expiredToken, expiredUserId),
        (error: unknown) => error instanceof TenantConflictError,
      );

      const declined = await membershipRepository.invite({ email: invitationEmails.declined });
      const [declinedOutbox] = await db
        .select()
        .from(invitationEmailOutbox)
        .where(eq(invitationEmailOutbox.invitationId, declined.invitation.id));
      assert.ok(declinedOutbox);
      const declinedToken = invitationToken(declinedOutbox);
      await declineInvitation(declinedToken, declinedUserId);
      assert.equal((await inspectInvitation(declinedToken)).status, "declined");

      await expectUniqueViolation(() =>
        db.insert(invitations).values({
          organizationId,
          workspaceId,
          email: `hash-${randomUUID()}@example.test`,
          status: "revoked",
          tokenHash: resent.tokenHash,
          tokenVersion: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );
      await expectUniqueViolation(() =>
        db.insert(invitationEmailOutbox).values({
          organizationId,
          workspaceId,
          invitationId: created.invitation.id,
          tokenVersion: 2,
          recipientEmail: invitationEmails.invitee,
          idempotencyKey: `duplicate-${randomUUID()}`,
        }),
      );

      const commentRepository = createCommentsRepository({ organizationId, workspaceId, actorId: ownerId });
      const topLevel = await commentRepository.create({
        taskId,
        userId: ownerId,
        content: "Hello @[Mentioned Member] twice @[Mentioned Member]",
        mentionedUserIds: [mentionedId, mentionedId],
      });
      assert.deepEqual(topLevel.mentionedUserIds, [mentionedId]);
      assert.equal(
        (await db.select().from(commentMentions).where(eq(commentMentions.commentId, topLevel.id))).length,
        1,
      );
      assert.equal(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.entityId, taskId), eq(notifications.userId, mentionedId)))
        ).length,
        1,
      );
      await expectUniqueViolation(() =>
        db.insert(commentMentions).values({
          organizationId,
          workspaceId,
          projectId,
          taskId,
          commentId: topLevel.id,
          mentionedUserId: mentionedId,
        }),
      );
      const [mentionNotification] = await db
        .select()
        .from(notifications)
        .where(and(eq(notifications.entityId, taskId), eq(notifications.userId, mentionedId)));
      assert.ok(mentionNotification?.deduplicationKey);
      await expectUniqueViolation(() =>
        db.insert(notifications).values({
          organizationId,
          workspaceId,
          userId: mentionedId,
          type: "comment_mention",
          title: "Duplicate",
          deduplicationKey: mentionNotification.deduplicationKey,
          actionPath: "/safe",
        }),
      );
      await assert.rejects(
        () =>
          db.insert(notifications).values({
            organizationId,
            workspaceId,
            userId: mentionedId,
            type: "unsafe",
            title: "Unsafe path",
            actionPath: "https://evil.example",
          }),
        (error: unknown) => hasDatabaseCode(error, "23514"),
      );

      await commentRepository.update(topLevel.id, {
        content: "Mention remains @[Mentioned Member]",
        mentionedUserIds: [mentionedId],
      });
      assert.equal(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.entityId, taskId), eq(notifications.userId, mentionedId)))
        ).length,
        1,
      );
      await commentRepository.update(topLevel.id, { content: "Mention removed", mentionedUserIds: [] });
      assert.equal(
        (await db.select().from(commentMentions).where(eq(commentMentions.commentId, topLevel.id))).length,
        0,
      );
      await commentRepository.update(topLevel.id, {
        content: "Mention added again @[Mentioned Member]",
        mentionedUserIds: [mentionedId],
      });
      assert.equal(
        (
          await db
            .select()
            .from(notifications)
            .where(and(eq(notifications.entityId, taskId), eq(notifications.userId, mentionedId)))
        ).length,
        2,
      );
      await assert.rejects(
        () =>
          commentRepository.create({
            taskId,
            userId: ownerId,
            content: "Invalid outsider mention",
            mentionedUserIds: [outsiderId],
          }),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );
      const selfMention = await commentRepository.create({
        taskId,
        userId: ownerId,
        content: "Self mention",
        mentionedUserIds: [ownerId],
      });
      assert.deepEqual(selfMention.mentionedUserIds, []);
      const replyRepository = createCommentsRepository({ organizationId, workspaceId, actorId: mentionedId });
      const reply = await replyRepository.create({
        taskId,
        userId: mentionedId,
        parentId: topLevel.id,
        content: "A reply",
      });
      assert.equal(reply.parentId, topLevel.id);
      await assert.rejects(
        () =>
          commentRepository.create({
            taskId,
            userId: ownerId,
            parentId: reply.id,
            content: "Too deeply nested",
          }),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );
      const [differentTaskComment] = await db
        .insert(comments)
        .values({ organizationId, workspaceId, taskId: secondTaskId, userId: ownerId, content: "Different task" })
        .returning();
      await assert.rejects(
        () =>
          commentRepository.create({
            taskId,
            userId: ownerId,
            parentId: differentTaskComment.id,
            content: "Cross-task reply",
          }),
        (error: unknown) => error instanceof TenantResourceNotFoundError,
      );
      await commentRepository.delete(topLevel.id);
      assert.equal(
        (await db.select().from(commentMentions).where(eq(commentMentions.commentId, topLevel.id))).length,
        0,
      );

      const onboarding = createOnboardingRepository({ organizationId, workspaceId, actorId: ownerId });
      await assert.rejects(
        () => onboarding.update(mentionedId, { completedSteps: ["board_explored"] }),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );
      await assert.rejects(
        () => onboarding.update(ownerId, { completedSteps: ["arbitrary_client_step"] }),
        (error: unknown) => error instanceof TenantPermissionDeniedError,
      );
      const progress = await onboarding.update(ownerId, { completedSteps: ["board_explored"], dismissed: true });
      assert.ok(progress.dismissedAt);
      const resumed = await onboarding.update(ownerId, { dismissed: false });
      assert.equal(resumed.dismissedAt, null);
      await expectUniqueViolation(() =>
        db.insert(userOnboardingProgress).values({
          organizationId,
          workspaceId,
          userId: ownerId,
          completedSteps: [],
        }),
      );

      await createOnboardingRepository({
        organizationId: otherOrganizationId,
        workspaceId: otherWorkspaceId,
        actorId: outsiderId,
      }).update(outsiderId, { completedSteps: ["board_explored"] });
      const otherInvitation = await createMembershipsRepository({
        organizationId: otherOrganizationId,
        workspaceId: otherWorkspaceId,
        actorId: outsiderId,
      }).invite({ email: `other-invite-${randomUUID()}@example.test` });
      assert.ok(otherInvitation.invitation.id);
      const [otherComment] = await db
        .insert(comments)
        .values({
          organizationId: otherOrganizationId,
          workspaceId: otherWorkspaceId,
          taskId: otherTaskId,
          userId: outsiderId,
          content: "Other tenant comment",
        })
        .returning();
      await db.insert(commentMentions).values({
        organizationId: otherOrganizationId,
        workspaceId: otherWorkspaceId,
        projectId: otherProjectId,
        taskId: otherTaskId,
        commentId: otherComment.id,
        mentionedUserId: outsiderId,
      });
      await db.insert(commentMentions).values({
        organizationId,
        workspaceId,
        projectId,
        taskId,
        commentId: selfMention.id,
        mentionedUserId: ownerId,
      });

      await pool.query(
        `CREATE ROLE ${quoteIdentifier(restrictedRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roleCreated = true;
      await pool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(restrictedRole)}`);
      await pool.query(
        `GRANT SELECT ON public.comment_mentions, public.invitation_email_outbox, public.user_onboarding_progress TO ${quoteIdentifier(restrictedRole)}`,
      );
      const restrictedClient = await pool.connect();
      try {
        await restrictedClient.query("begin");
        await restrictedClient.query(`set local role ${quoteIdentifier(restrictedRole)}`);
        for (const table of ["comment_mentions", "invitation_email_outbox", "user_onboarding_progress"]) {
          const withoutContext = await restrictedClient.query(`select organization_id from ${table}`);
          assert.deepEqual(withoutContext.rows, []);
        }
        await restrictedClient.query(
          "select set_config('app.organization_id', $1, true), set_config('app.workspace_id', $2, true)",
          [organizationId, workspaceId],
        );
        for (const table of ["comment_mentions", "invitation_email_outbox", "user_onboarding_progress"]) {
          const tenantRows = await restrictedClient.query<{ organization_id: string }>(
            `select distinct organization_id from ${table}`,
          );
          assert.deepEqual(tenantRows.rows, [{ organization_id: organizationId }]);
        }
        await restrictedClient.query(
          "select set_config('app.organization_id', $1, true), set_config('app.workspace_id', $2, true)",
          [otherOrganizationId, otherWorkspaceId],
        );
        for (const table of ["comment_mentions", "invitation_email_outbox", "user_onboarding_progress"]) {
          const tenantRows = await restrictedClient.query<{ organization_id: string }>(
            `select distinct organization_id from ${table}`,
          );
          assert.deepEqual(tenantRows.rows, [{ organization_id: otherOrganizationId }]);
        }
        await restrictedClient.query("rollback");
      } finally {
        restrictedClient.release();
      }
    } finally {
      const tenantIds = [organizationId, otherOrganizationId];
      if (roleCreated) {
        await pool.query(`DROP ROLE IF EXISTS ${quoteIdentifier(restrictedRole)}`).catch(() => undefined);
      }
      await pool
        .query("delete from notification_email_outbox where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from notifications where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from comment_mentions where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from comments where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from automation_events where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from activities where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from invitation_email_outbox where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from invitations where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from user_onboarding_progress where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool.query("delete from tasks where organization_id = any($1::uuid[])", [tenantIds]).catch(() => undefined);
      await pool
        .query("delete from projects where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from memberships where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool
        .query("delete from workspaces where organization_id = any($1::uuid[])", [tenantIds])
        .catch(() => undefined);
      await pool.query("delete from organizations where id = any($1::uuid[])", [tenantIds]).catch(() => undefined);
      await pool
        .query("delete from users where id = any($1::uuid[])", [
          [ownerId, inviteeId, mentionedId, outsiderId, expiredUserId, declinedUserId],
        ])
        .catch(() => undefined);
    }
  });
});
