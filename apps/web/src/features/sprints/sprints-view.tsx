"use client";

import { useState, useEffect } from "react";
import type { ViewCtx } from "@/lib/types";
import { SprintBacklogView } from "./sprint-backlog-view";
import { SprintBoardView } from "./sprint-board-view";
import { SprintReportsView } from "./sprint-reports-view";
import { IconList, IconBoard, IconGauge } from "@/components/icons";
import { cn } from "@/lib/utils";

export function SprintsView({
  ctx,
  defaultTab = "backlog",
}: {
  ctx: ViewCtx;
  defaultTab?: "backlog" | "active" | "reports";
}) {
  const [tab, setTab] = useState<"backlog" | "active" | "reports">(defaultTab);

  // Sync tab if defaultTab changes (e.g. from routing redirect)
  useEffect(() => {
    setTab(defaultTab);
  }, [defaultTab]);

  return (
    <div className="flex flex-col h-full animate-fade">
      <div className="mb-6 flex border-b border-slate-200 dark:border-white/[0.07]">
        <nav className="-mb-px flex space-x-6 rtl:space-x-reverse" aria-label="Tabs">
          <button
            onClick={() => setTab("backlog")}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 py-3 px-1 text-[13px] font-medium transition-colors",
              tab === "backlog"
                ? "border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            <IconList size={15} />
            {ctx.t("التراكم", "Backlog")}
          </button>

          <button
            onClick={() => setTab("active")}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 py-3 px-1 text-[13px] font-medium transition-colors",
              tab === "active"
                ? "border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            <IconBoard size={15} />
            {ctx.t("السبرنت النشط", "Active Sprint")}
          </button>

          <button
            onClick={() => setTab("reports")}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 py-3 px-1 text-[13px] font-medium transition-colors",
              tab === "reports"
                ? "border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-300",
            )}
          >
            <IconGauge size={15} />
            {ctx.t("التقارير", "Reports")}
          </button>
        </nav>
      </div>

      <div className="flex-1 min-h-0">
        {tab === "backlog" && <SprintBacklogView ctx={ctx} />}
        {tab === "active" && <SprintBoardView ctx={ctx} />}
        {tab === "reports" && <SprintReportsView ctx={ctx} />}
      </div>
    </div>
  );
}
