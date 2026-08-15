import type { Dispatch, SetStateAction } from "react";
import type { Comment, Organization, Task, User, Workspace } from "@/lib/types";
import { confirmAction } from "@/components/feedback";
import { createCommentRecord, deleteCommentRecord, updateCommentRecord } from "@/features/comments/api";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

type CommentOperationsInput = {
  taskDetail: Task | null;
  currentUser: User | null;
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  comments: Comment[];
  setComments: Setter<Comment[]>;
  t: Translator;
  notify: Notify;
};

export function useCommentOperations(input: CommentOperationsInput) {
  const { taskDetail, currentUser, activeOrg, activeWorkspace, comments, setComments, t, notify } = input;

  const addComment = async (content: string, options: { parentId?: string; mentionedUserIds?: string[] } = {}) => {
    if (!taskDetail || !currentUser || !activeOrg || !activeWorkspace || !content.trim()) return;
    const created = await createCommentRecord({
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      taskId: taskDetail.id,
      userId: currentUser.id,
      actorId: currentUser.id,
      content,
      ...options,
    });
    if (created.id) setComments((previous) => [{ ...created, user: currentUser }, ...previous]);
  };

  const toggleReaction = async (commentId: string, emoji: string) => {
    if (!currentUser || !activeOrg || !activeWorkspace) return;
    const comment = comments.find((candidate) => candidate.id === commentId);
    if (!comment) return;
    const reactions = { ...(comment.reactions || {}) };
    const users = reactions[emoji] || [];
    reactions[emoji] = users.includes(currentUser.name)
      ? users.filter((name) => name !== currentUser.name)
      : [...users, currentUser.name];
    setComments((previous) =>
      previous.map((candidate) => (candidate.id === commentId ? { ...candidate, reactions } : candidate)),
    );
    await updateCommentRecord({
      id: commentId,
      reactions,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser.id,
    });
  };

  const togglePinComment = async (id: string, isPinned: boolean) => {
    if (!activeOrg || !activeWorkspace) return;
    setComments((previous) => previous.map((comment) => (comment.id === id ? { ...comment, isPinned } : comment)));
    await updateCommentRecord({
      id,
      isPinned,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
    });
    notify(isPinned ? t("تم تثبيت التعليق 📌", "Comment pinned 📌") : t("تم إلغاء التثبيت", "Comment unpinned"));
  };

  const deleteComment = async (id: string) => {
    if (!activeOrg || !activeWorkspace) return;
    const confirmed = await confirmAction({
      title: t("حذف التعليق", "Delete comment"),
      message: t("هل أنت متأكد من حذف التعليق؟", "Delete comment?"),
      tone: "danger",
    });
    if (!confirmed) return;
    setComments((previous) => previous.filter((comment) => comment.id !== id));
    await deleteCommentRecord(id, {
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
    });
    notify(t("تم حذف التعليق 🗑️", "Comment deleted"));
  };

  const editComment = async (id: string, content: string, mentionedUserIds?: string[]) => {
    if (!activeOrg || !activeWorkspace) return;
    setComments((previous) => previous.map((comment) => (comment.id === id ? { ...comment, content } : comment)));
    await updateCommentRecord({
      id,
      content,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
      ...(mentionedUserIds === undefined ? {} : { mentionedUserIds }),
    });
    notify(t("تم تعديل التعليق ✓", "Comment edited ✓"));
  };

  return { addComment, toggleReaction, togglePinComment, deleteComment, editComment };
}
