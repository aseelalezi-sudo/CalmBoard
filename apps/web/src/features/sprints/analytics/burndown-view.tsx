"use client";

import { useState, useMemo } from "react";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { useSprintTimeline } from "./use-sprint-analytics";
import { useSprints } from "../use-sprints";
import { Card, Btn, ScreenState } from "@/components/ui";
import { IconTimeline, IconDash, IconShield } from "@/components/icons";
import { isAnalyticsIntegrityError } from "./api";

export function BurndownView({ ctx }: { ctx: ViewCtx }) {
  const sprintQuery = useSprints(ctx.activeProject, ctx.currentUser?.id);
  const eligibleSprints = useMemo(() => {
    const sprintsList = sprintQuery.data ?? [];
    return sprintsList
      .filter((s) => s.status === "active" || s.status === "completed" || s.status === "cancelled")
      .sort((a, b) => {
        if (a.status === "active") return -1;
        if (b.status === "active") return 1;
        const timeA = new Date(a.completedAt ?? a.cancelledAt ?? a.updatedAt).getTime();
        const timeB = new Date(b.completedAt ?? b.cancelledAt ?? b.updatedAt).getTime();
        return timeB - timeA;
      });
  }, [sprintQuery.data]);

  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(() => eligibleSprints[0]?.id ?? null);

  if (!selectedSprintId && eligibleSprints.length > 0) {
    setSelectedSprintId(eligibleSprints[0].id);
  }

  const timezone = "UTC";
  const query = useSprintTimeline(ctx.activeProject, selectedSprintId, timezone, ctx.currentUser?.id);

  if (!ctx.can("sprints.view")) {
    return (
      <ScreenState
        tone="permission"
        icon={<IconShield size={20} />}
        title={ctx.t("صلاحية السبرنتات مطلوبة", "Sprint permission required")}
        description={ctx.t("ليست لديك صلاحية عرض السبرنتات.", "You do not have permission to view Sprints.")}
      />
    );
  }

  if (sprintQuery.isLoading) {
    return (
      <ScreenState
        tone="loading"
        icon={<IconTimeline size={20} />}
        title={ctx.t("جارٍ تحميل السبرنتات…", "Loading Sprints…")}
      />
    );
  }

  if (sprintQuery.isError) {
    return (
      <ScreenState
        tone="error"
        icon={<IconTimeline size={20} />}
        title={ctx.t("تعذر تحميل قائمة السبرنتات", "Could not load Sprints list")}
        description={ctx.t("تحقق من الاتصال بالخادم ثم حاول مجدداً.", "Check connection and try again.")}
        action={<Btn onClick={() => void sprintQuery.refetch()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
      />
    );
  }

  if (eligibleSprints.length === 0) {
    return (
      <Card className="p-10 text-center">
        <IconTimeline className="mx-auto text-accent mb-3" size={32} />
        <h3 className="font-semibold text-ink">{ctx.t("لا يوجد سبرنتات حالية", "No current sprints")}</h3>
        <p className="mt-2 text-sm text-ink-faint max-w-md mx-auto">
          {ctx.t("ابدأ سبرنت لرؤية مخطط الإنجاز (Burndown).", "Start a sprint to see the burndown chart.")}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={selectedSprintId ?? ""}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-xs outline-none focus:border-accent"
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
          <span className="text-xs font-medium text-ink-faint bg-raised px-2 py-0.5 rounded">{timezone}</span>
        </div>
      </div>

      <Card className="p-6">
        {query.isLoading ? (
          <div className="h-64 flex items-center justify-center">
            <span className="text-sm text-ink-faint">{ctx.t("جارٍ تحميل المخطط...", "Loading chart...")}</span>
          </div>
        ) : query.isError ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <IconDash size={28} className="text-rose-400 mb-2" />
            <p className="text-sm text-rose-600 dark:text-rose-400">
              {isAnalyticsIntegrityError(query.error)
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
        <p className="text-sm text-ink-faint">
          {ctx.t(
            "لم يتم تسجيل المخطط الزمني التاريخي لهذا السبرنت.",
            "Historical timeline was not captured for this sprint.",
          )}
        </p>
      </div>
    );
  }

  const series = data.series;
  const chartWidth = Math.max(560, series.length * 64);
  const maxPoints = Math.max(
    ...series.map((s) => Math.max(s.remainingPoints, s.totalScopePoints, s.idealRemainingPoints ?? 0)),
    10,
  );
  const yMax = Math.ceil(maxPoints * 1.15);

  return (
    <div className="relative h-80 w-full overflow-x-auto pt-4">
      <div style={{ minWidth: `${chartWidth}px` }} className="relative h-full w-full">
        <div className="absolute inset-0 flex" dir="ltr">
          <div className="w-8 flex flex-col justify-between text-right text-[10px] text-ink-faint pb-6 pr-2">
            <span>{fmtNumber(yMax, ctx.locale)}</span>
            <span>{fmtNumber(Math.round(yMax * 0.75), ctx.locale)}</span>
            <span>{fmtNumber(Math.round(yMax * 0.5), ctx.locale)}</span>
            <span>{fmtNumber(Math.round(yMax * 0.25), ctx.locale)}</span>
            <span>{fmtNumber(0, ctx.locale)}</span>
          </div>

          <div className="flex-1 relative border-l border-b border-line pb-6">
            {[0, 0.25, 0.5, 0.75].map((percent) => (
              <div
                key={percent}
                className="absolute w-full border-t border-line/40"
                style={{ bottom: `${percent * 100}%` }}
              />
            ))}

            <svg
              className="absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={ctx.t("مخطط الإنجاز", "Burndown chart")}
            >
              {series[0].idealRemainingPoints !== null && (
                <polyline
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  className="text-ink-faint opacity-50"
                  points={series
                    .map((point, i) => {
                      const x = (i / Math.max(1, series.length - 1)) * 100;
                      const y = 100 - (point.idealRemainingPoints! / yMax) * 100;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
              )}

              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent"
                points={series
                  .map((point, i) => {
                    const x = (i / Math.max(1, series.length - 1)) * 100;
                    const y = 100 - (point.remainingPoints / yMax) * 100;
                    return `${x},${y}`;
                  })
                  .join(" ")}
              />
            </svg>

            <div className="absolute inset-0 flex justify-between">
              {series.map((point) => {
                const dateObj = new Date(point.date);
                const dateStr = dateObj.toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US", {
                  month: "short",
                  day: "numeric",
                });

                return (
                  <div
                    key={point.date}
                    tabIndex={0}
                    aria-label={`${dateStr}: ${fmtNumber(point.remainingPoints, ctx.locale)} ${ctx.t("نقطة متبقية", "points remaining")}`}
                    className="relative group flex flex-col items-center h-full w-full focus-visible:outline-none"
                  >
                    <div className="absolute inset-y-0 w-full hover:bg-raised/40 group-focus-within:bg-raised/40 z-10" />

                    <div className="pointer-events-none absolute bottom-full mb-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <div
                        dir={ctx.locale === "ar" ? "rtl" : "ltr"}
                        className="whitespace-nowrap rounded-lg bg-surface border border-line p-2 text-xs text-ink shadow-xl"
                      >
                        <div className="font-bold text-center mb-1">{dateStr}</div>
                        <div className="flex gap-3 text-[11px]">
                          <div>
                            <div className="text-ink-faint">{ctx.t("المتبقي", "Remaining")}</div>
                            <div className="font-bold text-accent">{fmtNumber(point.remainingPoints, ctx.locale)}</div>
                          </div>
                          <div>
                            <div className="text-ink-faint">{ctx.t("النطاق", "Scope")}</div>
                            <div className="font-bold text-ink">{fmtNumber(point.totalScopePoints, ctx.locale)}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="absolute -bottom-6 w-full text-center text-[10px] text-ink-faint truncate px-1">
                      {dateStr}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
