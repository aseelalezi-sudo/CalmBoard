import { useState } from "react";
import type { Automation, ViewCtx } from "@/lib/types";
import { updateTaskRecord } from "@/features/tasks/api";

export function useAutomationTest(ctx: ViewCtx) {
  const [testingId, setTestingId] = useState<string | null>(null);

  const testRun = async (rule: Automation) => {
    if (!ctx.tasks?.length) {
      ctx.notify(ctx.t("لا توجد مهام لاختبار القاعدة عليها", "No tasks available to test rule"), "error");
      return;
    }
    setTestingId(rule.id);
    const targetTask = ctx.tasks[0];
    try {
      const actions = rule.actions as Record<string, string> | undefined;
      const updated = await updateTaskRecord({
        id: targetTask.id,
        expectedVersion: targetTask.version,
        status: actions?.setStatus || "review",
        priority: actions?.setPriority || "urgent",
        organizationId: targetTask.organizationId,
        workspaceId: targetTask.workspaceId,
        actorId: ctx.currentUser?.id,
      });
      if (updated.id) {
        ctx.notify(
          `▶️ ${ctx.t("تم إطلاق التشغيل التجريبي بنجاح على المهمة", "Test run triggered successfully on")} [${targetTask.serial}] ✓`,
        );
        ctx.updateTask(targetTask.id, updated);
      }
    } finally {
      setTestingId(null);
    }
  };

  return { testingId, testRun };
}
