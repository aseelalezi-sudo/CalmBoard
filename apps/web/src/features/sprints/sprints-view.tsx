"use client";

import { useState, useEffect } from "react";
import type { ViewCtx } from "@/lib/types";
import { SegmentedTabs } from "@/components/ui";
import { SprintBacklogView } from "./sprint-backlog-view";
import { SprintBoardView } from "./sprint-board-view";
import { SprintReportsView } from "./sprint-reports-view";
import { IconList, IconBoard, IconGauge } from "@/components/icons";

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
      <div className="mb-6 flex">
        <SegmentedTabs
          value={tab}
          label={ctx.t("أقسام السبرنت", "Sprint sections")}
          onChange={(val) => setTab(val as "backlog" | "active" | "reports")}
          items={[
            {
              id: "backlog",
              label: (
                <span className="flex items-center gap-2">
                  <IconList size={15} />
                  {ctx.t("التراكم", "Backlog")}
                </span>
              ),
            },
            {
              id: "active",
              label: (
                <span className="flex items-center gap-2">
                  <IconBoard size={15} />
                  {ctx.t("السبرنت النشط", "Active Sprint")}
                </span>
              ),
            },
            {
              id: "reports",
              label: (
                <span className="flex items-center gap-2">
                  <IconGauge size={15} />
                  {ctx.t("التقارير", "Reports")}
                </span>
              ),
            },
          ]}
        />
      </div>

      <div className="flex-1 min-h-0">
        {tab === "backlog" && <SprintBacklogView ctx={ctx} />}
        {tab === "active" && <SprintBoardView ctx={ctx} />}
        {tab === "reports" && <SprintReportsView ctx={ctx} />}
      </div>
    </div>
  );
}
