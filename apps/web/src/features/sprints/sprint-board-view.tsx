"use client";

import { useMemo } from "react";
import type { ViewCtx } from "@/lib/types";
import { STATUS_ORDER } from "@/lib/types";
import { Btn, Card } from "@/components/ui";
import { BoardView } from "@/features/tasks/task-views";
import { useSprints } from "./use-sprints";

export function SprintBoardView({ ctx }: { ctx: ViewCtx }) {
  const { data: sprints = [], isLoading } = useSprints(ctx.activeProject, ctx.currentUser?.id);
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

  if (isLoading) return <div className="h-72 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/5" />;
  if (!activeSprint)
    return (
      <Card className="p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
          {ctx.t("لا يوجد سبرنت نشط", "No active Sprint")}
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          {ctx.t(
            "ابدأ سبرنتاً مخططاً من صفحة السبرنتات لعرض مهامه هنا.",
            "Start a planned Sprint from Sprint planning to see its tasks here.",
          )}
        </p>
        <Btn className="mt-4" onClick={() => ctx.setActiveView("sprints")}>
          {ctx.t("فتح تخطيط السبرنت", "Open Sprint planning")}
        </Btn>
      </Card>
    );

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
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-slate-950 dark:text-white">{activeSprint.name}</h2>
        {activeSprint.goal && <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">{activeSprint.goal}</p>}
      </div>
      <BoardView ctx={boardCtx} />
    </div>
  );
}
