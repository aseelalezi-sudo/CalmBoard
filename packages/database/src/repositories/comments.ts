import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { TenantResourceNotFoundError } from "../errors.js";
import { automationEvents, comments, tasks, users } from "../schema.js";
import { assertWorkspaceTenantContext, type DatabaseTenantContext } from "../tenant-context.js";

export type CreateCommentInput = {
  taskId: string;
  userId: string;
  content: string;
  parentId?: string | null;
};

export type UpdateCommentInput = {
  reactions?: Record<string, string[]>;
  content?: string;
  isPinned?: boolean;
};

export function createCommentsRepository(context: DatabaseTenantContext) {
  assertWorkspaceTenantContext(context);

  const taskScope = and(eq(tasks.organizationId, context.organizationId), eq(tasks.workspaceId, context.workspaceId));
  const commentScope = and(
    eq(comments.organizationId, context.organizationId),
    eq(comments.workspaceId, context.workspaceId),
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
      .where(and(eq(tasks.id, taskId), taskScope))
      .limit(1);

    if (!task) {
      throw new TenantResourceNotFoundError("task");
    }
    return task;
  }

  async function requireComment(commentId: string) {
    const [comment] = await db
      .select({ id: comments.id })
      .from(comments)
      .innerJoin(tasks, eq(comments.taskId, tasks.id))
      .where(and(eq(comments.id, commentId), commentScope, taskScope))
      .limit(1);

    if (!comment) {
      throw new TenantResourceNotFoundError("comment");
    }
  }

  return {
    async listByTask(taskId: string) {
      return db
        .select({
          comment: comments,
          user: users,
        })
        .from(comments)
        .innerJoin(tasks, eq(comments.taskId, tasks.id))
        .leftJoin(users, eq(comments.userId, users.id))
        .where(and(eq(comments.taskId, taskId), commentScope, taskScope))
        .orderBy(desc(comments.createdAt))
        .then((rows) =>
          rows.map(({ comment, user }) => ({
            ...comment,
            user: user ?? undefined,
          })),
        );
    },

    async create(input: CreateCommentInput) {
      const task = await requireTask(input.taskId);
      return db.transaction(async (transaction) => {
        const [comment] = await transaction
          .insert(comments)
          .values({
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            taskId: input.taskId,
            userId: input.userId,
            content: input.content,
            parentId: input.parentId,
          })
          .returning();
        const depth = context.automation ? context.automation.depth + 1 : 0;
        if (depth <= 5) {
          await transaction.insert(automationEvents).values({
            organizationId: context.organizationId,
            workspaceId: context.workspaceId!,
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
        return comment;
      });
    },

    async update(commentId: string, input: UpdateCommentInput) {
      await requireComment(commentId);

      const [comment] = await db
        .update(comments)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(and(eq(comments.id, commentId), commentScope))
        .returning();

      return comment;
    },

    async delete(commentId: string) {
      await requireComment(commentId);
      await db
        .update(comments)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(comments.id, commentId), commentScope));
    },
  };
}
