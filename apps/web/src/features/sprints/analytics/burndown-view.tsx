"use client";

import { useState, useMemo } from "react";
import type { ViewCtx } from "@/lib/types";
import { useSprintTimeline } from "./use-sprint-analytics";
import { useSprints } from "../use-sprints";
import { Card, Btn } from "@/components/ui";
import { IconTimeline, IconDash } from "@/components/icons";
import { ApiError } from "@/lib/client-api";

export function BurndownView({ ctx }: { ctx: ViewCtx }) {
  const sprintQuery = useSprints(ctx.activeProject, ctx.currentUser?.id);
  const eligibleSprints = useMemo(() => {
    const sprintsList = sprintQuery.data ?? [];
    return sprintsList
      .filter((s) => s.status === "active" || s.status === "completed" || s.status === "cancelled")
      .sort((a, b) => {
        // active first, then most recently completed/cancelled
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
        const timeA = new Date(a.completedAt ?? a.cancelledAt ?? a.updatedAt).getTime();
        const timeB = new Date(b.completedAt ?? b.cancelledAt ?? b.updatedAt).getTime();
        return timeB - timeA;
      });
  }, [sprintQuery.data]);

  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(() => eligibleSprints[0]?.id ?? null);

  // If sprints load and we have none selected, pick the first
  if (!selectedSprintId && eligibleSprints.length > 0) {
    setSelectedSprintId(eligibleSprints[0].id);
  }

  // Timezone hardcoded to UTC per v1 requirements
  const timezone = "UTC";

  const query = useSprintTimeline(ctx.activeProject, selectedSprintId, timezone, ctx.currentUser?.id);

  if (!ctx.can("sprints.view")) {
    return (
      <Card className="p-8 text-center text-sm text-slate-600 dark:text-zinc-400">
        {ctx.t("ليست لديك صلاحية عرض السبرنتات.", "You do not have permission to view Sprints.")}
      </Card>
    );
  }

  if (sprintQuery.isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-48 rounded-lg bg-slate-200/70 dark:bg-white/5" />
        <div className="h-64 rounded-2xl bg-slate-200/70 dark:bg-white/5" />
      </div>
    );
  }

  if (eligibleSprints.length === 0) {
    return (
      <Card className="p-10 text-center">
        <IconTimeline className="mx-auto text-indigo-500 mb-3" size={32} />
        <h3 className="font-semibold text-slate-950 dark:text-white">
          {ctx.t("لا يوجد سبرنتات حالية", "No current sprints")}
        </h3>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          {ctx.t("ابدأ سبرنت لرؤية مخطط الإنجاز (Burndown).", "Start a sprint to see the burndown chart.")}
        </p>
      </Card>
    );
  }

  const selectedSprintObj = eligibleSprints.find((s) => s.id === selectedSprintId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={selectedSprintId ?? ""}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
          >
            {eligibleSprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}{" "}
                {sprint.status === "active"
                  ? `(${ctx.t("نشط", "Active")})`
                  : sprint.status === "cancelled"
                    ? `(${ctx.t("ملغى", "Cancelled")})`
                    : ""}
              </option>
            ))}
          </select>
          <span className="text-xs font-medium text-slate-400 dark:text-zinc-500 bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded">
            {timezone}
          </span>
        </div>
      </div>

      <Card className="p-6">
        {query.isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <span className="text-sm text-slate-400">{ctx.t("جارٍ تحميل المخطط...", "Loading chart...")}</span>
          </div>
        ) : query.isError ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <IconDash size={28} className="text-rose-400 mb-2" />
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {query.error instanceof ApiError &&
              query.error.status === 500 &&
              (query.error.payload as any)?.code === "ANALYTICS_INTEGRITY_ERROR"
                ? ctx.t(
                    "لا يمكن التحقق من صحة بيانات التحليلات لهذا السبرنت.",
                    "Analytics data could not be verified for this sprint.",
                  )
                : ctx.t(
                    "لم يتم تسجيل المخطط الزمني التاريخي لهذا السبرنت.",
                    "Historical timeline was not captured for this sprint.",
                  )}
            </p>
            <Btn className="mt-4" onClick={() => void query.refetch()}>
              {ctx.t("إعادة المحاولة", "Try again")}
            </Btn>
          </div>
        ) : query.data ? (
          <BurndownChart data={query.data} ctx={ctx} />
        ) : null}
      </Card>
    </div>
  );
}

function BurndownChart({
  data,
  ctx,
}: {
  data: Exclude<ReturnType<typeof useSprintTimeline>["data"], undefined>;
  ctx: ViewCtx;
}) {
  if (data.series.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-center">
        <p className="text-sm text-slate-500">
          {ctx.t(
            "لم يتم تسجيل المخطط الزمني التاريخي لهذا السبرنت.",
            "Historical timeline was not captured for this sprint.",
          )}
        </p>
      </div>
    );
  }

  // Calculate max height for Y axis based on totalScopePoints and remainingPoints
  const maxPoints = Math.max(
    ...data.series.map((s) => Math.max(s.remainingPoints, s.totalScopePoints, s.idealRemainingPoints ?? 0)),
    10,
  );

  const yMax = Math.ceil(maxPoints * 1.15); // Add 15% padding at top

  return (
    <div className="relative h-80 w-full pt-4">
      {/* Chart Canvas */}
      <div className="absolute inset-0 flex" dir="ltr">
        {/* Y-axis labels */}
        <div className="w-8 flex flex-col justify-between text-right text-[10px] text-slate-400 pb-6 pr-2">
          <span>{yMax}</span>
          <span>{Math.round(yMax * 0.75)}</span>
          <span>{Math.round(yMax * 0.5)}</span>
          <span>{Math.round(yMax * 0.25)}</span>
          <span>0</span>
        </div>

        {/* Main chart area */}
        <div className="flex-1 relative border-l border-b border-slate-200 dark:border-white/10 pb-6">
          {/* Horizontal Grid lines */}
          {[0, 0.25, 0.5, 0.75].map((percent) => (
            <div
              key={percent}
              className="absolute w-full border-t border-slate-100 dark:border-white/5"
              style={{ bottom: `${percent * 100}%` }}
            />
          ))}

          {/* SVG for lines */}
          <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
            {/* Ideal Line */}
            {data.series[0].idealRemainingPoints !== null && (
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="4 4"
                className="text-slate-300 dark:text-zinc-600"
                points={data.series
                  .map((point, i) => {
                    const x = (i / Math.max(1, data.series.length - 1)) * 100;
                    const y = 100 - (point.idealRemainingPoints! / yMax) * 100;
                    return `${x}%,${y}%`;
                  })
                  .join(" ")}
              />
            )}

            {/* Remaining Points Line */}
            <polyline
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-indigo-500"
              points={data.series
                .map((point, i) => {
                  const x = (i / Math.max(1, data.series.length - 1)) * 100;
                  const y = 100 - (point.remainingPoints / yMax) * 100;
                  return `${x}%,${y}%`;
                })
                .join(" ")}
            />
          </svg>

          {/* Data points for hover and X-axis labels */}
          <div className="absolute inset-0 flex justify-between">
            {data.series.map((point, i) => {
              const dateObj = new Date(point.date);
              const dateStr = dateObj.toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US", {
                month: "short",
                day: "numeric",
              });

              return (
                <div key={point.date} className="relative group flex flex-col items-center h-full w-full">
                  {/* Invisible hover column */}
                  <div className="absolute inset-y-0 w-full hover:bg-slate-50/50 dark:hover:bg-white/5 z-10" />

                  {/* Tooltip */}
                  <div className="pointer-events-none absolute bottom-full mb-2 z-20 opacity-0 transition-opacity group-hover:opacity-100">
                    <div
                      dir={ctx.locale === "ar" ? "rtl" : "ltr"}
                      className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-xl dark:bg-white dark:text-slate-900"
                    >
                      <div className="font-bold text-center mb-1">{dateStr}</div>
                      <div className="flex gap-4">
                        <div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            {ctx.t("المتبقي", "Remaining")}
                          </div>
                          <div className="font-bold text-indigo-400 dark:text-indigo-600">{point.remainingPoints}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500">
                            {ctx.t("النطاق", "Scope")}
                          </div>
                          <div className="font-bold">{point.totalScopePoints}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* X-axis label */}
                  <div className="absolute -bottom-6 w-full text-center text-[10px] text-slate-500 truncate px-1">
                    {dateStr}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="absolute top-0 right-4 flex gap-4 text-[11px] font-medium text-slate-500 dark:text-zinc-400">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-indigo-500" />
          {ctx.t("المتبقي", "Remaining")}
        </div>
        {data.series[0].idealRemainingPoints !== null && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 border-t border-dashed border-slate-400 dark:border-zinc-500" />
            {ctx.t("المثالي", "Ideal")}
          </div>
        )}
        {data.dataQuality === "reconstructed" && (
          <div className="rounded bg-amber-100 px-1.5 text-[10px] text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
            {ctx.t("مُعاد بناءه", "Reconstructed")}
          </div>
        )}
      </div>

      {/* Accessible Table Fallback */}
      <div className="sr-only">
        <table>
          <caption>{ctx.t("بيانات مخطط الإنجاز", "Burndown Chart Data")}</caption>
          <thead>
            <tr>
              <th>{ctx.t("التاريخ", "Date")}</th>
              <th>{ctx.t("المتبقي", "Remaining Points")}</th>
              <th>{ctx.t("النطاق", "Total Scope")}</th>
              {data.series[0].idealRemainingPoints !== null && <th>{ctx.t("المثالي", "Ideal Remaining")}</th>}
            </tr>
          </thead>
          <tbody>
            {data.series.map((point) => (
              <tr key={point.date}>
                <td>{point.date}</td>
                <td>{point.remainingPoints}</td>
                <td>{point.totalScopePoints}</td>
                {point.idealRemainingPoints !== null && <td>{point.idealRemainingPoints}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
