import type { Dispatch, SetStateAction } from "react";
import type { Automation, Doc, Goal, Organization, User, Workspace } from "@/lib/types";
import { updateAutomationRecord } from "@/features/automations/api";
import { checkInGoalRecord, linkGoalTaskRecord, unlinkGoalTaskRecord } from "@/features/goals/api";
import { patchDocument } from "@/features/workspace/actions-api";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

type ContentOperationsInput = {
  currentUser: User | null;
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  setActiveDoc: Setter<Doc | null>;
  setDocs: Setter<Doc[]>;
  setGoals: Setter<Goal[]>;
  setAutomations: Setter<Automation[]>;
  t: Translator;
  notify: Notify;
};

export function useContentOperations(input: ContentOperationsInput) {
  const { currentUser, activeOrg, activeWorkspace, setActiveDoc, setDocs, setGoals, setAutomations, t, notify } = input;

  const patchDoc = async (id: string, patch: Partial<Doc>) => {
    if (!activeOrg || !activeWorkspace) return;
    try {
      const updated = await patchDocument(id, {
        ...patch,
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        actorId: currentUser?.id,
      });
      setDocs((previous) => previous.map((doc) => (doc.id === id ? { ...doc, ...updated } : doc)));
      setActiveDoc((previous) => (previous?.id === id ? { ...previous, ...updated } : previous));
    } catch {
      notify(t("تعذر حفظ تغييرات المستند", "Failed to save document changes"), "error");
    }
  };

  const goalScope = () =>
    activeOrg && activeWorkspace
      ? {
          organizationId: activeOrg.id,
          workspaceId: activeWorkspace.id,
          actorId: currentUser?.id,
        }
      : null;

  const replaceGoal = (updated: Goal) => {
    setGoals((previous) => {
      const next = previous.map((goal) => (goal.id === updated.id ? updated : goal));
      if (!updated.parentId) return next;
      const children = next.filter((goal) => goal.parentId === updated.parentId);
      const totalWeight = children.reduce((sum, goal) => sum + goal.weight, 0);
      const progress =
        totalWeight > 0
          ? Math.round(children.reduce((sum, goal) => sum + goal.progress * goal.weight, 0) / totalWeight)
          : 0;
      return next.map((goal) =>
        goal.id === updated.parentId
          ? {
              ...goal,
              progress,
              status:
                progress >= 100 ? "achieved" : progress >= 60 ? "on_track" : progress >= 30 ? "at_risk" : "off_track",
            }
          : goal,
      );
    });
  };

  const addGoalCheckin = async (id: string, checkin: { note: string; progress?: number; currentValue?: number }) => {
    const scope = goalScope();
    if (!scope) return;
    try {
      replaceGoal(await checkInGoalRecord(id, checkin, scope));
      notify(t("تم تسجيل تقدم الهدف ✓", "Goal check-in recorded ✓"));
    } catch {
      notify(t("تعذر تسجيل تقدم الهدف", "Failed to record goal check-in"), "error");
    }
  };

  const linkGoalTask = async (goalId: string, taskId: string, weight = 1) => {
    const scope = goalScope();
    if (!scope) return;
    try {
      replaceGoal(await linkGoalTaskRecord(goalId, taskId, weight, scope));
      notify(t("تم ربط المهمة بالنتيجة الرئيسية", "Task linked to key result"));
    } catch {
      notify(t("تعذر ربط المهمة بالنتيجة الرئيسية", "Failed to link task"), "error");
    }
  };

  const unlinkGoalTask = async (goalId: string, taskId: string) => {
    const scope = goalScope();
    if (!scope) return;
    try {
      replaceGoal(await unlinkGoalTaskRecord(goalId, taskId, scope));
    } catch {
      notify(t("تعذر إزالة ارتباط المهمة", "Failed to unlink task"), "error");
    }
  };

  const toggleAutomation = async (id: string, enabled: boolean) => {
    if (!activeOrg || !activeWorkspace) return;
    setAutomations((previous) =>
      previous.map((automation) => (automation.id === id ? { ...automation, enabled } : automation)),
    );
    try {
      await updateAutomationRecord(id, enabled, {
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        actorId: currentUser?.id,
      });
    } catch {
      setAutomations((previous) =>
        previous.map((automation) => (automation.id === id ? { ...automation, enabled: !enabled } : automation)),
      );
      notify(t("تعذر تحديث قاعدة الأتمتة", "Failed to update automation"), "error");
      return;
    }
    notify(enabled ? t("فُعّلت القاعدة", "Rule enabled") : t("عُطّلت القاعدة", "Rule disabled"));
  };

  return { patchDoc, addGoalCheckin, linkGoalTask, unlinkGoalTask, toggleAutomation };
}
