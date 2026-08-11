"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { useVelocitySeries } from "./use-sprint-analytics";
import { Card, Btn } from "@/components/ui";
import { IconRocket, IconList } from "@/components/icons";
import { cn } from "@/lib/utils";

export function VelocityView({ ctx }: { ctx: ViewCtx }) {
  const [limit, setLimit] = useState(10);
  const query = useVelocitySeries(ctx.activeProject, limit, ctx.currentUser?.id);

  if (!ctx.can("sprints.view")) {
    return (
      <Card className="p-8 text-center text-sm text-slate-600 dark:text-zinc-400">
        {ctx.t("ليست لديك صلاحية عرض السبرنتات.", "You do not have permission to view Sprints.")}
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-48 rounded-lg bg-slate-200/70 dark:bg-white/5" />
        <div className="h-64 rounded-2xl bg-slate-200/70 dark:bg-white/5" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {ctx.t("تعذر تحميل بيانات السرعة.", "Could not load Velocity data.")}
        </p>
        <Btn className="mt-4" onClick={() => void query.refetch()}>
          {ctx.t("إعادة المحاولة", "Try again")}
        </Btn>
      </Card>
    );
  }

  const data = query.data;
  if (!data) return null;

  if (data.series.length === 0) {
    return (
      <Card className="p-10 text-center">
        <IconRocket className="mx-auto text-indigo-500 mb-3" size={32} />
        <h3 className="font-semibold text-slate-950 dark:text-white">
          {ctx.t("أكمل بعض السبرنتات", "Complete a few sprints")}
        </h3>
        <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
          {ctx.t(
            "أكمل بعض السبرنتات لرؤية اتجاه السرعة الخاص بفريقك.",
            "Complete a few sprints to see your team's velocity trend.",
          )}
        </p>
      </Card>
    );
  }

  // Calculate max height for the Y axis
  const maxPoints = Math.max(...data.series.map((s) => s.completedStoryPoints), data.averageStoryPoints ?? 0, 10);

  // Create safe max to give some headroom (e.g., 20% above the highest value)
  const yMax = Math.ceil(maxPoints * 1.2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          {ctx.t("اتجاه السرعة", "Velocity Trend")}
          {data.averageStoryPoints !== null && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-white/5 dark:text-zinc-300">
              {ctx.t("المتوسط:", "Avg:")} {data.averageStoryPoints} {ctx.t("نقاط", "pts")}
            </span>
          )}
        </h3>

        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white"
        >
          <option value={5}>{ctx.t("آخر 5 سبرنتات", "Last 5 sprints")}</option>
          <option value={10}>{ctx.t("آخر 10 سبرنتات", "Last 10 sprints")}</option>
          <option value={20}>{ctx.t("آخر 20 سبرنتات", "Last 20 sprints")}</option>
          <option value={50}>{ctx.t("آخر 50 سبرنتات", "Last 50 sprints")}</option>
        </select>
      </div>

      <Card className="p-6">
        <div className="relative h-64 w-full flex items-end justify-between gap-2 pt-6" dir="ltr">
          {/* Average Line */}
          {data.averageStoryPoints !== null && (
            <div
              className="absolute left-0 right-0 border-t-2 border-dashed border-indigo-400/50 z-0 pointer-events-none"
              style={{ bottom: `${(data.averageStoryPoints / yMax) * 100}%` }}
            >
              <div className="absolute -top-5 right-0 text-[10px] font-bold text-indigo-500 bg-white/80 dark:bg-zinc-900/80 px-1">
                {ctx.t("المتوسط", "AVG")}
              </div>
            </div>
          )}

          {data.series.map((sprint, i) => {
            const heightPercent = (sprint.completedStoryPoints / yMax) * 100;
            return (
              <div
                key={sprint.sprintId}
                className="group relative flex flex-1 flex-col items-center justify-end h-full z-10"
              >
                {/* Tooltip */}
                <div className="pointer-events-none absolute -top-12 z-20 flex opacity-0 transition-opacity group-hover:opacity-100">
                  <div
                    dir={ctx.locale === "ar" ? "rtl" : "ltr"}
                    className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-center text-xs text-white shadow-xl dark:bg-white dark:text-slate-900"
                  >
                    <div className="font-bold">{sprint.name}</div>
                    <div>
                      {sprint.completedStoryPoints} {ctx.t("نقطة", "pts")} • {sprint.completedTaskCount}{" "}
                      {ctx.t("مهمة", "tasks")}
                    </div>
                  </div>
                </div>

                {/* Bar */}
                <div
                  className="w-full max-w-12 rounded-t-sm bg-indigo-500 transition-all group-hover:bg-indigo-600 dark:bg-indigo-400 dark:group-hover:bg-indigo-300"
                  style={{ height: `${heightPercent}%`, minHeight: sprint.completedStoryPoints > 0 ? "4px" : "0" }}
                />

                {/* Label */}
                <div
                  className="mt-3 w-full truncate text-center text-[10px] font-medium text-slate-500 dark:text-zinc-400"
                  title={sprint.name}
                >
                  {sprint.name}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mt-8">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
          <IconList size={16} />
          {ctx.t("بيانات السرعة التاريخية", "Historical Velocity Data")}
        </h4>
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm text-slate-600 dark:text-zinc-400 rtl:text-right">
            <thead className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-semibold uppercase text-slate-500 dark:border-white/5 dark:bg-white/5 dark:text-zinc-500">
              <tr>
                <th className="px-5 py-3">{ctx.t("السبرنت", "Sprint")}</th>
                <th className="px-5 py-3">{ctx.t("تاريخ الاكتمال", "Completed Date")}</th>
                <th className="px-5 py-3 text-right rtl:text-left">{ctx.t("السرعة (نقاط)", "Velocity (Pts)")}</th>
                <th className="px-5 py-3 text-right rtl:text-left">
                  {ctx.t("الإنتاجية (مهام)", "Throughput (Tasks)")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {[...data.series].reverse().map((sprint) => (
                <tr key={sprint.sprintId} className="hover:bg-slate-50/50 dark:hover:bg-white/5">
                  <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{sprint.name}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {sprint.completedAt
                      ? new Date(sprint.completedAt).toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US")
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-right rtl:text-left font-bold mono">{sprint.completedStoryPoints}</td>
                  <td className="px-5 py-3 text-right rtl:text-left font-bold mono">{sprint.completedTaskCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
