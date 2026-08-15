"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { ScreenHeader, SegmentedTabs } from "@/components/ui";
import { ReportsOverview } from "./analytics/reports-overview";
import { VelocityView } from "./analytics/velocity-view";
import { BurndownView } from "./analytics/burndown-view";

export function SprintReportsView({ ctx }: { ctx: ViewCtx }) {
  const [tab, setTab] = useState<"overview" | "velocity" | "burndown">("overview");

  if (!ctx.activeProject) return null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 animate-fade">
      <ScreenHeader
        title={ctx.t("تقارير وتحليلات السبرنت", "Sprint Reports & Analytics")}
        description={ctx.t(
          "متابعة دقيقة لمؤشرات السرعة، المتبقي، ومعدلات الإنجاز.",
          "Track velocity, burndown, and completion metrics across sprints.",
        )}
        actions={
          <SegmentedTabs
            value={tab}
            label={ctx.t("نوع التقرير", "Report type")}
            onChange={(val) => setTab(val as "overview" | "velocity" | "burndown")}
            items={[
              { id: "overview", label: ctx.t("نظرة عامة", "Overview") },
              { id: "velocity", label: ctx.t("السرعة", "Velocity") },
              { id: "burndown", label: ctx.t("المتبقي", "Burndown") },
            ]}
          />
        }
      />

      <div className="flex-1 min-h-0">
        {tab === "overview" && <ReportsOverview ctx={ctx} />}
        {tab === "velocity" && <VelocityView ctx={ctx} />}
        {tab === "burndown" && <BurndownView ctx={ctx} />}
      </div>
    </div>
  );
}
