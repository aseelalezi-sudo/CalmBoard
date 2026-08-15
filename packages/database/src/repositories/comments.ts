import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../client.js";
import { TenantPermissionDeniedError, TenantResourceNotFoundError } from "../errors.js";
import { automationEvents, commentMentions, comments, memberships, tasks, users } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";
import { createNotificationsRepository } from "./notifications.js";

type DatabaseTransaction = Parameters<Parameters<(typeof db)["transaction"]>[0]>[0];

export type CreateCommentInput = {
  taskId: string;
  userId: string;
  content: string;
  parentId?: string | null;
  mentionedUserIds?: string[];
};

export type UpdateCommentInput = {
  reactions?: Record<string, string[]>;
  content?: string;
  isPinned?: boolean;
  mentionedUserIds?: string[];
};

const moderatorRoles = new Set(["owner", "admin"]);

export function createCommentsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);
  const organizationId = context.organizationId;
  const workspaceId = context.workspaceId;
  const taskScope = and(eq(tasks.organizationId, organizationId), eq(tasks.workspaceId, workspaceId));
  const commentScope = and(
    eq(comments.organizationId, organizationId),
    eq(comments.workspaceId, workspaceId),
    isNull(comments.deletedAt),
  );

  async function requireTask(taskId: string) {
    const [task] = await db
      .select({
        id: tasks.id,
        version: tasks.version,
        status: tasks.status,
        priority: tasks.priority,
        projectId: tasks.projectId,
        assigneeId: tasks.assigneeId,
        tags: tasks.tags,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), taskScope, isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) throw new TenantResourceNotFoundError("task");
    return task;
  }

  async function requireComment(commentId: string) {
    const [row] = await db
      .select({ comment: comments, projectId: tasks.projectId })
      .from(comments)
      .innerJoin(tasks, eq(comments.taskId, tasks.id))
      .where(and(eq(comments.id, commentId), commentScope, taskScope, isNull(tasks.deletedAt)))
      .limit(1);
    if (!row) throw new TenantResourceNotFoundError("comment");
    return row;
  }

  async function requireTopLevelParent(parentId: string, taskId: string, projectId: string) {
    const [parent] = await db
      .select({ id: comments.id, userId: comments.userId, parentId: comments.parentId })
      .from(comments)
      .innerJoin(tasks, eq(comments.taskId, tasks.id))
      .where(
        and(
          eq(comments.id, parentId),
          eq(comments.taskId, taskId),
          eq(tasks.projectId, projectId),
          commentScope,
          taskScope,
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    if (!parent) throw new TenantResourceNotFoundError("parent comment");
    if (parent.parentId) throw new TenantPermissionDeniedError("Replies may only target a top-level comment");
    return parent;
  }

  async function eligibleMentionIds(userIds: string[], authorId: string) {
    const unique = [...new Set(userIds.filter((id) => id && id !== authorId))];
    if (unique.length > 50) throw new TenantPermissionDeniedError("A comment may mention at most 50 members");
    if (!unique.length) return [];
    const eligible = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          inArray(memberships.userId, unique),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      );
    const eligibleSet = new Set(eligible.map((row) => row.userId));
    if (unique.some((id) => !eligibleSet.has(id))) {
      throw new TenantPermissionDeniedError("Mentioned users must be active members of this workspace");
    }
    return unique;
  }

  async function actorRole() {
    if (!context.actorId) throw new TenantPermissionDeniedError("actorId is required for comment mutation");
    const [membership] = await db
      .select({ role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, context.actorId),
          eq(memberships.organizationId, organizationId),
          eq(memberships.status, "active"),
          or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
        ),
      )
      .limit(1);
    if (!membership) throw new TenantPermissionDeniedError();
    return membership.role;
  }

  async function dispatchCollaborationNotification(
    input: {
      userId: string;
      type: "comment_mention" | "comment_reply";
      title: string;
      body: string;
      taskId: string;
      commentId: string;
      deduplicationKey: string;
    },
    transaction: DatabaseTransaction,
  ) {
    const repository = createNotificationsRepository(context, transaction);
    const { user, preferences } = await repository.getDeliveryProfile(input.userId);
    let notificationId: string | null = null;
    const notificationInput = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: "task",
      entityId: input.taskId,
      deduplicationKey: input.deduplicationKey,
      actionPath: `/?taskId=${encodeURIComponent(input.taskId)}&commentId=${encodeURIComponent(input.commentId)}`,
    };
    if (preferences?.inAppEnabled !== false) {
      notificationId = (await repository.create(notificationInput)).id;
    }
    if (user.email && preferences?.emailEnabled !== false) {
      await repository.enqueueEmail(notificationInput, notificationId);
    }
  }

  async function insertMentionRelations(
    input: {
      commentId: string;
      taskId: string;
      projectId: string;
      mentionedUserIds: string[];
      authorId: string;
      content: string;
    },
    transaction: DatabaseTransaction,
  ) {
    if (!input.mentionedUserIds.length) return;
    const relations = await transaction
      .insert(commentMentions)
      .values(
        input.mentionedUserIds.map((mentionedUserId) => ({
          organizationId,
          workspaceId,
          projectId: input.projectId,
          taskId: input.taskId,
          commentId: input.commentId,
          mentionedUserId,
        })),
      )
      .onConflictDoNothing()
      .returning();
    for (const relation of relations) {
      await dispatchCollaborationNotification(
        {
          userId: relation.mentionedUserId,
          type: "comment_mention",
          title: "تمت الإشارة إليك",
          body: input.content.slice(0, 500),
          taskId: input.taskId,
          commentId: input.commentId,
          deduplicationKey: `mention:${input.commentId}:${relation.id}`,
        },
        transaction,
      );
    }
  }

  return {
    async listByTask(taskId: string) {
      const rows = await db
        .select({ comment: comments, user: users })
        .from(comments)
        .innerJoin(tasks, eq(comments.taskId, tasks.id))
        .leftJoin(users, eq(comments.userId, users.id))
        .where(and(eq(comments.taskId, taskId), commentScope, taskScope, isNull(tasks.deletedAt)))
        .orderBy(asc(comments.createdAt));
      const commentIds = rows.map(({ comment }) => comment.id);
      const mentions = commentIds.length
        ? await db
            .select({ commentId: commentMentions.commentId, userId: commentMentions.mentionedUserId })
            .from(commentMentions)
            .where(
              and(
                eq(commentMentions.organizationId, organizationId),
                eq(commentMentions.workspaceId, workspaceId),
                inArray(commentMentions.commentId, commentIds),
              ),
            )
        : [];
      const mentionMap = new Map<string, string[]>();
      for (const mention of mentions) {
        mentionMap.set(mention.commentId, [...(mentionMap.get(mention.commentId) ?? []), mention.userId]);
      }
      return rows.map(({ comment, user }) => ({
        ...comment,
        mentionedUserIds: mentionMap.get(comment.id) ?? [],
        user: user ?? undefined,
      }));
    },

    async listEligibleMentionUsers(taskId: string, search = "") {
      await requireTask(taskId);
      const normalized = search.trim().toLowerCase();
      const rows = await db
        .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            or(isNull(memberships.workspaceId), eq(memberships.workspaceId, workspaceId)),
          ),
        )
        .orderBy(asc(users.name))
        .limit(100);
      return rows
        .filter((user) => !normalized || `${user.name} ${user.email}`.toLowerCase().includes(normalized))
        .slice(0, 20);
    },

    async create(input: CreateCommentInput) {
      if (!context.actorId || input.userId !== context.actorId) {
        throw new TenantPermissionDeniedError("Comment author must match the authenticated actor");
      }
      const task = await requireTask(input.taskId);
      const parent = input.parentId ? await requireTopLevelParent(input.parentId, input.taskId, task.projectId) : null;
      const mentionedUserIds = await eligibleMentionIds(input.mentionedUserIds ?? [], input.userId);
      return db.transaction(async (transaction) => {
        const [comment] = await transaction
          .insert(comments)
          .values({
            organizationId,
            workspaceId,
            taskId: input.taskId,
            userId: input.userId,
            content: input.content,
            parentId: input.parentId,
          })
          .returning();
        if (!comment) throw new Error("Comment insert did not return a row");
        await insertMentionRelations(
          {
            commentId: comment.id,
            taskId: input.taskId,
            projectId: task.projectId,
            mentionedUserIds,
            authorId: input.userId,
            content: input.content,
          },
          transaction,
        );
        if (parent && parent.userId !== input.userId && !mentionedUserIds.includes(parent.userId)) {
          await dispatchCollaborationNotification(
            {
              userId: parent.userId,
              type: "comment_reply",
              title: "رد جديد على تعليقك",
              body: input.content.slice(0, 500),
              taskId: input.taskId,
              commentId: comment.id,
              deduplicationKey: `reply:${comment.id}:${parent.userId}`,
            },
            transaction,
          );
        }
        const depth = context.automation ? context.automation.depth + 1 : 0;
        if (depth <= 5) {
          await transaction.insert(automationEvents).values({
            organizationId,
            workspaceId,
            taskId: input.taskId,
            trigger: "comment_added",
            taskVersion: task.version,
            actorId: input.userId,
            previous: null,
            current: {
              status: task.status,
              priority: task.priority,
              projectId: task.projectId,
              assigneeId: task.assigneeId,
              tags: task.tags,
              version: task.version,
            },
            depth,
            parentEventId: context.automation?.parentEventId ?? null,
            deduplicationKey: `comment/${comment.id}/comment_added`,
          });
        }
        return { ...comment, mentionedUserIds };
      });
    },

    async update(commentId: string, input: UpdateCommentInput) {
      const { comment, projectId } = await requireComment(commentId);
      const role = await actorRole();
      const moderator = moderatorRoles.has(role);
      if (input.content !== undefined && comment.userId !== context.actorId && !moderator) {
        throw new TenantPermissionDeniedError("Only the author or a moderator can edit this comment");
      }
      if (input.isPinned !== undefined && !moderator) {
        throw new TenantPermissionDeniedError("Only a moderator can pin comments");
      }
      const afterMentionIds =
        input.mentionedUserIds === undefined
          ? undefined
          : await eligibleMentionIds(input.mentionedUserIds, comment.userId);
      return db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(comments)
          .set({
            ...(input.reactions === undefined ? {} : { reactions: input.reactions }),
            ...(input.content === undefined ? {} : { content: input.content }),
            ...(input.isPinned === undefined ? {} : { isPinned: input.isPinned }),
            updatedAt: new Date(),
          })
          .where(and(eq(comments.id, commentId), commentScope))
          .returning();
        if (!updated) throw new TenantResourceNotFoundError("comment");
        if (afterMentionIds !== undefined) {
          const beforeRows = await transaction
            .select({ userId: commentMentions.mentionedUserId })
            .from(commentMentions)
            .where(
              and(
                eq(commentMentions.organizationId, organizationId),
                eq(commentMentions.workspaceId, workspaceId),
                eq(commentMentions.commentId, commentId),
              ),
            );
          const before = new Set(beforeRows.map((row) => row.userId));
          const after = new Set(afterMentionIds);
          const removed = [...before].filter((id) => !after.has(id));
          const added = [...after].filter((id) => !before.has(id));
          if (removed.length) {
            await transaction
              .delete(commentMentions)
              .where(and(eq(commentMentions.commentId, commentId), inArray(commentMentions.mentionedUserId, removed)));
          }
          await insertMentionRelations(
            {
              commentId,
              taskId: comment.taskId,
              projectId,
              mentionedUserIds: added,
              authorId: comment.userId,
              content: updated.content,
            },
            transaction,
          );
        }
        return { ...updated, ...(afterMentionIds === undefined ? {} : { mentionedUserIds: afterMentionIds }) };
      });
    },

    async delete(commentId: string) {
      const { comment } = await requireComment(commentId);
      const role = await actorRole();
      if (comment.userId !== context.actorId && !moderatorRoles.has(role)) {
        throw new TenantPermissionDeniedError("Only the author or a moderator can delete this comment");
      }
      await db.transaction(async (transaction) => {
        await transaction.delete(commentMentions).where(eq(commentMentions.commentId, commentId));
        await transaction
          .update(comments)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(comments.id, commentId), commentScope));
      });
    },
  };
}
