"use client";

import type { ViewCtx } from "@/lib/types";
import { useSprintAnalyticsOverview } from "./use-sprint-analytics";
import { Card, Btn } from "@/components/ui";
import { IconRocket, IconGauge } from "@/components/icons";
import { ApiError } from "@/lib/client-api";
import { SprintSummaryCard } from "./sprint-summary-card";

export function ReportsOverview({ ctx }: { ctx: ViewCtx }) {
  const query = useSprintAnalyticsOverview(ctx.activeProject, ctx.currentUser?.id);

  if (!ctx.can("sprints.view")) {
    return (
      <Card className="p-8 text-center text-sm text-slate-600 dark:text-zinc-400">
        {ctx.t("ليست لديك صلاحية عرض السبرنتات.", "You do not have permission to view Sprints.")}
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <div className="space-y-6" aria-label={ctx.t("جارٍ تحميل التقارير", "Loading Reports")}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/5" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/5" />
      </div>
    );
  }

  if (query.isError) {
    const isIntegrityError =
      query.error instanceof ApiError &&
      query.error.status === 500 &&
      (query.error.payload as any)?.code === "ANALYTICS_INTEGRITY_ERROR";
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {isIntegrityError
            ? ctx.t("لا يمكن التحقق من صحة بيانات التحليلات.", "Analytics data could not be verified.")
            : ctx.t("تعذر تحميل التقارير.", "Could not load Reports.")}
        </p>
        <Btn className="mt-4" onClick={() => void query.refetch()}>
          {ctx.t("إعادة المحاولة", "Try again")}
        </Btn>
      </Card>
    );
  }

  const data = query.data;
  if (!data) return null;

  if (data.completedSprints === 0) {
    return (
      <Card className="p-10 text-center">
        <IconGauge className="mx-auto text-indigo-500 mb-3" size={32} />
        <h3 className="font-semibold text-slate-950 dark:text-white">
          {ctx.t("أكمل بعض السبرنتات", "Complete a few sprints")}
        </h3>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          {ctx.t(
            "أكمل بعض السبرنتات لرؤية اتجاهات السرعة والإنتاجية لفريقك هنا.",
            "Complete a few sprints to see your team's velocity trend and throughput here.",
          )}
        </p>
      </Card>
    );
  }

  const renderMetricValue = (val: number | null, unit: string = "") => {
    if (val === null) return <span className="text-slate-400 font-normal text-xl">—</span>;
    return (
      <span>
        {val}
        {unit && <span className="text-sm font-normal text-slate-500 dark:text-zinc-400 ml-1">{unit}</span>}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-slate-500 dark:text-zinc-400">
            {ctx.t("متوسط السرعة", "Average Velocity")}
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900 dark:text-white mono tracking-tight">
            {renderMetricValue(data.averageVelocity)}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-slate-500 dark:text-zinc-400">
            {ctx.t("أحدث سرعة", "Latest Velocity")}
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900 dark:text-white mono tracking-tight">
            {renderMetricValue(data.latestVelocity)}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-slate-500 dark:text-zinc-400">
            {ctx.t("متوسط الإنتاجية", "Average Throughput")}
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900 dark:text-white mono tracking-tight">
            {renderMetricValue(data.averageThroughput)}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-slate-500 dark:text-zinc-400">
            {ctx.t("السبرنتات المكتملة", "Completed Sprints")}
          </div>
          <div className="mt-3 text-3xl font-bold text-slate-900 dark:text-white mono tracking-tight">
            {data.completedSprints}
          </div>
        </Card>
      </div>

      {data.latestSprintSummary && (
        <div className="mt-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400 flex items-center gap-2">
            <IconRocket size={16} />
            {ctx.t("أحدث سبرنت مكتمل", "Latest Completed Sprint")}
          </h3>
          <SprintSummaryCard ctx={ctx} summary={data.latestSprintSummary} />
        </div>
      )}
    </div>
  );
}
