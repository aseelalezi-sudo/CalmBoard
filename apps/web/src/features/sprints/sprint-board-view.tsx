"use client";

import { useMemo } from "react";
import type { ViewCtx } from "@/lib/types";
import { STATUS_ORDER } from "@/lib/types";
import { Btn, Card, ScreenHeader, ScreenState } from "@/components/ui";
import { IconRocket, IconShield } from "@/components/icons";
import { BoardView } from "@/features/tasks/task-views";
import { useSprints } from "./use-sprints";

export function SprintBoardView({ ctx }: { ctx: ViewCtx }) {
  const { data: sprints = [], isLoading, isError, refetch } = useSprints(ctx.activeProject, ctx.currentUser?.id);
  const activeSprint = sprints.find((sprint) => sprint.status === "active") ?? null;
  const sprintTasks = useMemo(
    () => (activeSprint ? ctx.tasks.filter((task) => task.sprintId === activeSprint.id) : []),
    [activeSprint, ctx.tasks],
  );
  const groupedByStatus = useMemo(
    () =>
      Object.fromEntries(STATUS_ORDER.map((status) => [status, sprintTasks.filter((task) => task.status === status)])),
    [sprintTasks],
  );

  if (!ctx.can("sprints.view")) {
    return (
      <ScreenState
        tone="permission"
        icon={<IconShield size={20} />}
        title={ctx.t("صلاحية السبرنتات مطلوبة", "Sprint permission required")}
        description={ctx.t(
          "ليست لديك صلاحية عرض لوحة السبرنت.",
          "You do not have permission to view the Sprint board.",
        )}
      />
    );
  }

  if (isLoading) {
    return (
      <ScreenState
        tone="loading"
        icon={<IconRocket size={20} />}
        title={ctx.t("جارٍ تحميل لوحة السبرنت…", "Loading sprint board…")}
      />
    );
  }

  if (isError) {
    return (
      <ScreenState
        tone="error"
        icon={<IconRocket size={20} />}
        title={ctx.t("تعذر تحميل لوحة السبرنت", "Could not load sprint board")}
        description={ctx.t("تحقق من الاتصال بالخادم وحاول مجدداً.", "Check server connection and try again.")}
        action={<Btn onClick={() => void refetch()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
      />
    );
  }

  if (!activeSprint) {
    return (
      <Card className="p-10 text-center">
        <h2 className="text-lg font-semibold text-ink">{ctx.t("لا يوجد سبرنت نشط", "No active Sprint")}</h2>
        <p className="mt-2 text-sm text-ink-faint">
          {ctx.t(
            "ابدأ سبرنتاً مخططاً من صفحة السبرنتات لعرض مهامه هنا.",
            "Start a planned Sprint from Sprint planning to see its tasks here.",
          )}
        </p>
        <Btn className="mt-4" onClick={() => ctx.setActiveView?.("sprints")}>
          {ctx.t("فتح تخطيط السبرنت", "Open Sprint planning")}
        </Btn>
      </Card>
    );
  }

  const boardCtx: ViewCtx = {
    ...ctx,
    tasks: sprintTasks,
    groupedByStatus,
    taskPagination: {
      ...ctx.taskPagination,
      mode: "full",
      total: sprintTasks.length,
      hasMore: false,
      statusTotals: Object.fromEntries(STATUS_ORDER.map((status) => [status, groupedByStatus[status]?.length ?? 0])),
      statusHasMore: Object.fromEntries(STATUS_ORDER.map((status) => [status, false])),
    },
  };

  return (
    <div className="space-y-4">
      <ScreenHeader title={activeSprint.name} description={activeSprint.goal ?? undefined} />
      <BoardView ctx={boardCtx} />
    </div>
  );
}
