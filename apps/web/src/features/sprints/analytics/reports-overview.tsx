"use client";

import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { useSprintAnalyticsOverview } from "./use-sprint-analytics";
import { Card, Btn, ScreenState } from "@/components/ui";
import { IconRocket, IconGauge, IconShield } from "@/components/icons";
import { ApiError } from "@/lib/client-api";
import { SprintSummaryCard } from "./sprint-summary-card";

export function ReportsOverview({ ctx }: { ctx: ViewCtx }) {
  const query = useSprintAnalyticsOverview(ctx.activeProject, ctx.currentUser?.id);

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

  if (query.isLoading) {
    return (
      <ScreenState
        tone="loading"
        icon={<IconRocket size={20} />}
        title={ctx.t("جارٍ تحميل التقارير…", "Loading Reports…")}
      />
    );
  }

  if (query.isError) {
    const isIntegrityError =
      query.error instanceof ApiError &&
      query.error.status === 500 &&
      typeof query.error.payload === "object" &&
      query.error.payload !== null &&
      "code" in query.error.payload &&
      query.error.payload.code === "ANALYTICS_INTEGRITY_ERROR";
    return (
      <ScreenState
        tone="error"
        icon={<IconRocket size={20} />}
        title={ctx.t("تعذر تحميل التقارير", "Could not load Reports")}
        description={
          isIntegrityError
            ? ctx.t("لا يمكن التحقق من صحة بيانات التحليلات.", "Analytics data could not be verified.")
            : ctx.t("تعذر تحميل التقارير.", "Could not load Reports.")
        }
        action={<Btn onClick={() => void query.refetch()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
      />
    );
  }

  const data = query.data;
  if (!data) return null;

  if (data.completedSprints === 0) {
    return (
      <Card className="p-10 text-center">
        <IconGauge className="mx-auto text-accent mb-3" size={32} />
        <h3 className="font-semibold text-ink">{ctx.t("أكمل بعض السبرنتات", "Complete a few sprints")}</h3>
        <p className="mt-2 text-sm text-ink-faint max-w-md mx-auto">
          {ctx.t(
            "أكمل بعض السبرنتات لرؤية اتجاهات السرعة والإنتاجية لفريقك هنا.",
            "Complete a few sprints to see your team's velocity trend and throughput here.",
          )}
        </p>
      </Card>
    );
  }

  const renderMetricValue = (val: number | null, unit: string = "") => {
    if (val === null) return <span className="text-ink-faint font-normal text-xl">—</span>;
    return (
      <span>
        {fmtNumber(val, ctx.locale)}
        {unit && <span className="text-sm font-normal text-ink-soft ml-1">{unit}</span>}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-ink-faint">{ctx.t("متوسط السرعة", "Average Velocity")}</div>
          <div className="mt-3 text-3xl font-bold text-ink mono tracking-tight">
            {renderMetricValue(data.averageVelocity)}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-ink-faint">{ctx.t("أحدث سرعة", "Latest Velocity")}</div>
          <div className="mt-3 text-3xl font-bold text-ink mono tracking-tight">
            {renderMetricValue(data.latestVelocity)}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-ink-faint">
            {ctx.t("متوسط الإنتاجية", "Average Throughput")}
          </div>
          <div className="mt-3 text-3xl font-bold text-ink mono tracking-tight">
            {renderMetricValue(data.averageThroughput)}
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div className="text-[13px] font-semibold text-ink-faint">
            {ctx.t("السبرنتات المكتملة", "Completed Sprints")}
          </div>
          <div className="mt-3 text-3xl font-bold text-ink mono tracking-tight">
            {fmtNumber(data.completedSprints, ctx.locale)}
          </div>
        </Card>
      </div>

      {data.latestSprintSummary && (
        <div className="mt-8">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-ink-faint flex items-center gap-2">
            <IconRocket size={16} />
            {ctx.t("أحدث سبرنت مكتمل", "Latest Completed Sprint")}
          </h3>
          <SprintSummaryCard ctx={ctx} summary={data.latestSprintSummary} />
        </div>
      )}
    </div>
  );
}
