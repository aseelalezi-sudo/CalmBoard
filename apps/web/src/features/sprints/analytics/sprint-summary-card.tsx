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
    <div className="flex flex-col p-4 bg-surface">
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-faint mb-2">
        {icon}
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        {points !== null ? (
          <span className="text-2xl font-bold mono tracking-tight text-ink">
            <bdi dir="ltr">{formatSprintMetric(points, ctx.locale, signed)}</bdi>{" "}
            <span className="text-[11px] font-normal text-ink-faint">{ctx.t("نقطة", "pts")}</span>
          </span>
        ) : (
          <span className="text-xl font-normal text-ink-faint">—</span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        {count !== null ? (
          <span className="text-[13px] font-medium text-ink-soft">
            <bdi dir="ltr">{formatSprintMetric(count, ctx.locale, signed)}</bdi>{" "}
            <span className="text-[11px] font-normal text-ink-faint">{ctx.t("مهام", "tasks")}</span>
          </span>
        ) : (
          <span className="text-[13px] font-normal text-ink-faint">—</span>
        )}
      </div>
    </div>
  );

  return (
    <Card className="overflow-hidden border border-line bg-surface">
      <div className="border-b border-line bg-raised/50 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink">{summary.name}</span>
          {isPartial && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
              {summary.dataQuality === "partial" ? ctx.t("جزئي", "Partial") : ctx.t("مُعاد بناءه", "Reconstructed")}
            </span>
          )}
        </div>
        {summary.completionRatio !== null && (
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
            {formatSprintMetric(Math.round(summary.completionRatio * 100), ctx.locale)}% {ctx.t("مكتمل", "completed")}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 divide-x rtl:divide-x-reverse divide-line bg-surface">
        {renderMetric(
          ctx.t("الالتزام", "Commitment"),
          <IconTarget size={14} className="text-ink-faint" />,
          summary.commitment.taskCount,
          summary.commitment.storyPoints,
        )}

        {renderMetric(
          ctx.t("النطاق النهائي", "Final Scope"),
          <IconRocket size={14} className="text-ink-faint" />,
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
          <IconTimeline size={14} className="text-accent" />,
          summary.netScopeChange.taskCount,
          summary.netScopeChange.storyPoints,
          true,
        )}
      </div>
    </Card>
  );
}
