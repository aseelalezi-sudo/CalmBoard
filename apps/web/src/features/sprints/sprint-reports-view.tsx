"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { ReportsOverview } from "./analytics/reports-overview";
import { VelocityView } from "./analytics/velocity-view";
import { BurndownView } from "./analytics/burndown-view";
import { cn } from "@/lib/utils";

export function SprintReportsView({ ctx }: { ctx: ViewCtx }) {
  const [tab, setTab] = useState<"overview" | "velocity" | "burndown">("overview");

  if (!ctx.activeProject) return null;

  return (
    <div className="flex flex-col h-full animate-fade">
      <div className="mb-6 flex justify-center">
        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-white/[0.07] dark:bg-white/3">
          <button
            onClick={() => setTab("overview")}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[12.5px] font-medium transition",
              tab === "overview"
                ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {ctx.t("نظرة عامة", "Overview")}
          </button>
          <button
            onClick={() => setTab("velocity")}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[12.5px] font-medium transition",
              tab === "velocity"
                ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {ctx.t("السرعة", "Velocity")}
          </button>
          <button
            onClick={() => setTab("burndown")}
            className={cn(
              "rounded-lg px-4 py-1.5 text-[12.5px] font-medium transition",
              tab === "burndown"
                ? "bg-white text-slate-900 shadow-sm dark:bg-white/10 dark:text-white"
                : "text-slate-500 hover:text-slate-700 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {ctx.t("المتبقي", "Burndown")}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 mx-auto w-full max-w-6xl">
        {tab === "overview" && <ReportsOverview ctx={ctx} />}
        {tab === "velocity" && <VelocityView ctx={ctx} />}
        {tab === "burndown" && <BurndownView ctx={ctx} />}
      </div>
    </div>
  );
}
