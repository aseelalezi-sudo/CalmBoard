"use client";

import type { ViewCtx } from "@/lib/types";
import { Card } from "@/components/ui";
import { IconTarget, IconRocket, IconCheck, IconTimeline, IconDash } from "@/components/icons";
import type { SprintAnalyticsDTO } from "./api";
import { formatSprintMetric } from "../sprint-presentation";

export function SprintSummaryCard({ ctx, summary }: { ctx: ViewCtx; summary: SprintAnalyticsDTO }) {
  const isPartial = summary.dataQuality === "partial" || summary.dataQuality === "reconstructed";
  const renderMetric = (
    label: string,
    icon: React.ReactNode,
    count: number | null,
    points: number | null,
    signed = false,
  ) => (
    <div className="flex flex-col p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 dark:text-zinc-400 mb-2">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        {points !== null ? (
          <span className="text-2xl font-bold mono tracking-tight text-slate-900 dark:text-white">
            <bdi dir="ltr">{formatSprintMetric(points, ctx.locale, signed)}</bdi>{" "}
            <span className="text-[11px] font-normal text-slate-500">{ctx.t("نقطة", "pts")}</span>
          </span>
        ) : (
          <span className="text-xl font-normal text-slate-400">—</span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        {count !== null ? (
          <span className="text-[13px] font-medium text-slate-600 dark:text-zinc-300">
            <bdi dir="ltr">{formatSprintMetric(count, ctx.locale, signed)}</bdi>{" "}
            <span className="text-[11px] font-normal text-slate-500">{ctx.t("مهام", "tasks")}</span>
          </span>
        ) : (
          <span className="text-[13px] font-normal text-slate-400">—</span>
        )}
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3 dark:border-white/5 dark:bg-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-white">{summary.name}</span>
          {isPartial && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              {summary.dataQuality === "partial" ? ctx.t("جزئي", "Partial") : ctx.t("مُعاد بناءه", "Reconstructed")}
            </span>
          )}
        </div>
        {summary.completionRatio !== null && (
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {Math.round(summary.completionRatio * 100)}% {ctx.t("مكتمل", "completed")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 divide-x rtl:divide-x-reverse divide-slate-100 dark:divide-white/5 bg-white dark:bg-transparent">
        {renderMetric(
          ctx.t("الالتزام", "Commitment"),
          <IconTarget size={14} className="text-slate-400" />,
          summary.commitment.taskCount,
          summary.commitment.storyPoints,
        )}

        {renderMetric(
          ctx.t("النطاق النهائي", "Final Scope"),
          <IconRocket size={14} className="text-slate-400" />,
          summary.finalScope.taskCount,
          summary.finalScope.storyPoints,
        )}

        {renderMetric(
          ctx.t("المكتمل", "Completed"),
          <IconCheck size={14} className="text-emerald-500" />,
          summary.completed.taskCount,
          summary.completed.storyPoints,
        )}

        {renderMetric(
          ctx.t("المتبقي", "Remaining"),
          <IconDash size={14} className="text-rose-400" />,
          summary.remaining.taskCount,
          summary.remaining.storyPoints,
        )}

        {renderMetric(
          ctx.t("تغيير النطاق", "Net Scope Change"),
          <IconTimeline size={14} className="text-indigo-400" />,
          summary.netScopeChange.taskCount,
          summary.netScopeChange.storyPoints,
          true,
        )}
      </div>
    </Card>
  );
}
