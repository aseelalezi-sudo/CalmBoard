import type { Dispatch, SetStateAction } from "react";
import type { Comment, Task, User } from "@/lib/types";
import type { ConfirmOptions } from "@/components/feedback";
import type { createCommentRecord, deleteCommentRecord, setCommentReactionRecord, updateCommentRecord } from "./api";

export type CommentOperationsInput = {
  taskDetail: Pick<Task, "id"> | null;
  currentUser: User | null;
  activeOrg: { id: string } | null;
  activeWorkspace: { id: string } | null;
  comments: Comment[];
  setComments: Dispatch<SetStateAction<Comment[]>>;
  t: (arabic: string, english: string) => string;
  notify: (message: string, kind?: "success" | "error") => void;
};

type Dependencies = {
  create: typeof createCommentRecord;
  update: typeof updateCommentRecord;
  remove: typeof deleteCommentRecord;
  react: typeof setCommentReactionRecord;
  confirmDelete: (options: ConfirmOptions) => Promise<boolean>;
};

function scopeKey(input: CommentOperationsInput) {
  return JSON.stringify([input.activeOrg?.id, input.activeWorkspace?.id, input.taskDetail?.id, input.currentUser?.id]);
}

// A session remains invalid after navigating A -> B -> A while a request runs.
export function createCommentOperations(initial: CommentOperationsInput, dependencies: Dependencies) {
  let input = initial;
  let session = { key: scopeKey(initial), active: true, pending: new Set<string>() };

  function synchronize(next: CommentOperationsInput) {
    const key = scopeKey(next);
    if (key !== session.key || !session.active) {
      session.active = false;
      session = { key, active: true, pending: new Set<string>() };
    }
    input = next;
  }

  function dispose() {
    session.active = false;
  }

  async function run(
    key: string,
    action: (context: {
      snapshot: CommentOperationsInput;
      scope: { organizationId: string; workspaceId: string; actorId: string };
      user: User;
      taskId: string;
      current: () => boolean;
      commit: (update: (comments: Comment[]) => Comment[]) => void;
    }) => Promise<boolean>,
  ) {
    const snapshot = input;
    const active = session;
    if (
      !active.active ||
      active.pending.has(key) ||
      !snapshot.taskDetail ||
      !snapshot.currentUser ||
      !snapshot.activeOrg ||
      !snapshot.activeWorkspace
    )
      return false;
    active.pending.add(key);
    const current = () => active.active && session === active;
    const commit = (update: (comments: Comment[]) => Comment[]) => {
      if (current()) snapshot.setComments((comments) => (current() ? update(comments) : comments));
    };
    try {
      const saved = await action({
        snapshot,
        scope: {
          organizationId: snapshot.activeOrg.id,
          workspaceId: snapshot.activeWorkspace.id,
          actorId: snapshot.currentUser.id,
        },
        user: snapshot.currentUser,
        taskId: snapshot.taskDetail.id,
        current,
        commit,
      });
      return saved && current();
    } catch {
      if (current())
        snapshot.notify(
          snapshot.t("تعذر حفظ التغيير على التعليق. حاول مجددًا.", "Could not save the comment change. Try again."),
          "error",
        );
      return false;
    } finally {
      active.pending.delete(key);
    }
  }

  const addComment = (content: string, options: { parentId?: string; mentionedUserIds?: string[] } = {}) => {
    if (!content.trim()) return Promise.resolve(false);
    return run("create", async ({ scope, user, taskId, commit }) => {
      const created = await dependencies.create({
        ...scope,
        taskId,
        userId: user.id,
        content: content.trim(),
        ...options,
      });
      if (!created.id) throw new Error("Comment creation returned no identifier");
      commit((comments) =>
        comments.some((comment) => comment.id === created.id) ? comments : [{ ...created, user }, ...comments],
      );
      return true;
    });
  };

  const patchComment = (
    id: string,
    changes: (comment: Comment, user: User) => Partial<Comment>,
    success?: (snapshot: CommentOperationsInput) => string,
    persist?: (
      scope: { organizationId: string; workspaceId: string; actorId: string },
      patch: Partial<Comment>,
    ) => Promise<Partial<Comment>>,
  ) =>
    run(`comment:${id}`, async ({ snapshot, scope, user, commit, current }) => {
      const original = snapshot.comments.find((comment) => comment.id === id);
      if (!original) return false;
      const patch = changes(original, user);
      commit((comments) => comments.map((comment) => (comment.id === id ? { ...comment, ...patch } : comment)));
      try {
        if (persist) {
          const canonical = await persist(scope, patch);
          commit((comments) => comments.map((comment) => (comment.id === id ? { ...comment, ...canonical } : comment)));
        } else await dependencies.update({ ...scope, id, ...patch });
      } catch (error) {
        // Restore this operation's fields only while they retain its optimistic
        // values; preserve unrelated changes and newer realtime updates.
        const keys = Object.keys(patch) as Array<keyof Comment>;
        commit((comments) =>
          comments.map((comment) =>
            comment.id !== id
              ? comment
              : {
                  ...comment,
                  ...Object.fromEntries(
                    keys.filter((key) => Object.is(comment[key], patch[key])).map((key) => [key, original[key]]),
                  ),
                },
          ),
        );
        throw error;
      }
      if (current() && success) snapshot.notify(success(snapshot));
      return true;
    });

  const toggleReaction = (id: string, emoji: string) =>
    patchComment(
      id,
      (comment, user) => {
        const reactionUserIds = { ...(comment.reactionUserIds ?? {}) };
        const users = reactionUserIds[emoji] ?? [];
        reactionUserIds[emoji] = users.includes(user.id)
          ? users.filter((userId) => userId !== user.id)
          : [...users, user.id];
        return { reactionUserIds };
      },
      undefined,
      async (scope, patch) => {
        const canonical = await dependencies.react({
          ...scope,
          id,
          emoji,
          active: patch.reactionUserIds?.[emoji]?.includes(scope.actorId) ?? false,
        });
        if (canonical.id !== id) throw new Error("Unexpected reaction response");
        return { reactions: canonical.reactions ?? {}, reactionUserIds: canonical.reactionUserIds ?? {} };
      },
    );

  const togglePinComment = (id: string, isPinned: boolean) =>
    patchComment(
      id,
      () => ({ isPinned }),
      ({ t }) => (isPinned ? t("تم تثبيت التعليق 📌", "Comment pinned 📌") : t("تم إلغاء التثبيت", "Comment unpinned")),
    );

  const editComment = (id: string, content: string, mentionedUserIds?: string[]) => {
    if (!content.trim()) return Promise.resolve(false);
    return patchComment(
      id,
      () => ({ content: content.trim(), ...(mentionedUserIds === undefined ? {} : { mentionedUserIds }) }),
      ({ t }) => t("تم تعديل التعليق ✓", "Comment edited ✓"),
    );
  };

  const deleteComment = (id: string) =>
    run(`comment:${id}`, async ({ snapshot, scope, current, commit }) => {
      const confirmed = await dependencies.confirmDelete({
        title: snapshot.t("حذف التعليق", "Delete comment"),
        message: snapshot.t("هل أنت متأكد من حذف التعليق؟", "Delete comment?"),
        tone: "danger",
      });
      if (!confirmed || !current()) return false;
      const comments = input.comments;
      const index = comments.findIndex((comment) => comment.id === id);
      if (index < 0) return false;
      const original = comments[index];
      const beforeId = comments[index - 1]?.id;
      const afterId = comments[index + 1]?.id;
      commit((previous) => previous.filter((comment) => comment.id !== id));
      try {
        await dependencies.remove(id, scope);
      } catch (error) {
        commit((previous) => {
          if (previous.some((comment) => comment.id === id)) return previous;
          const before = previous.findIndex((comment) => comment.id === beforeId);
          const after = previous.findIndex((comment) => comment.id === afterId);
          const position = after >= 0 ? after : before >= 0 ? before + 1 : Math.min(index, previous.length);
          return [...previous.slice(0, position), original, ...previous.slice(position)];
        });
        throw error;
      }
      if (current()) snapshot.notify(snapshot.t("تم حذف التعليق 🗑️", "Comment deleted"));
      return true;
    });

  return { addComment, toggleReaction, togglePinComment, deleteComment, editComment, synchronize, dispose };
}
