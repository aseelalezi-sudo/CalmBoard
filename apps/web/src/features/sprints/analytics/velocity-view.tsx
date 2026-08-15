"use client";

import { useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { useVelocitySeries } from "./use-sprint-analytics";
import { Card, Btn, ScreenState } from "@/components/ui";
import { IconRocket, IconList, IconShield } from "@/components/icons";

export function VelocityView({ ctx }: { ctx: ViewCtx }) {
  const [limit, setLimit] = useState(10);
  const query = useVelocitySeries(ctx.activeProject, limit, ctx.currentUser?.id);

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
        title={ctx.t("جارٍ تحميل بيانات السرعة…", "Loading Velocity…")}
      />
    );
  }

  if (query.isError) {
    return (
      <ScreenState
        tone="error"
        icon={<IconRocket size={20} />}
        title={ctx.t("تعذر تحميل بيانات السرعة", "Could not load Velocity data")}
        description={ctx.t("تحقق من الاتصال بالخادم ثم حاول مجدداً.", "Check connection and try again.")}
        action={<Btn onClick={() => void query.refetch()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
      />
    );
  }

  const data = query.data;
  if (!data) return null;

  if (data.series.length === 0) {
    return (
      <Card className="p-10 text-center">
        <IconRocket className="mx-auto text-accent mb-3" size={32} />
        <h3 className="font-semibold text-ink">{ctx.t("أكمل بعض السبرنتات", "Complete a few sprints")}</h3>
        <p className="mt-2 text-sm text-ink-faint max-w-md mx-auto">
          {ctx.t(
            "أكمل بعض السبرنتات لرؤية اتجاه السرعة الخاص بفريقك.",
            "Complete a few sprints to see your team's velocity trend.",
          )}
        </p>
      </Card>
    );
  }

  const maxPoints = Math.max(...data.series.map((s) => s.completedStoryPoints), data.averageStoryPoints ?? 0, 10);
  const yMax = Math.ceil(maxPoints * 1.2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-ink flex items-center gap-2">
          {ctx.t("اتجاه السرعة", "Velocity Trend")}
          {data.averageStoryPoints !== null && (
            <span className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-medium text-ink-soft">
              {ctx.t("المتوسط:", "Avg:")} {fmtNumber(data.averageStoryPoints, ctx.locale)} {ctx.t("نقاط", "pts")}
            </span>
          )}
        </h3>

        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink shadow-xs outline-none focus:border-accent"
        >
          <option value={5}>{ctx.t("آخر 5 سبرنتات", "Last 5 sprints")}</option>
          <option value={10}>{ctx.t("آخر 10 سبرنتات", "Last 10 sprints")}</option>
          <option value={20}>{ctx.t("آخر 20 سبرنتات", "Last 20 sprints")}</option>
          <option value={50}>{ctx.t("آخر 50 سبرنتات", "Last 50 sprints")}</option>
        </select>
      </div>

      <Card className="p-6">
        <div
          className="relative h-64 w-full flex items-end justify-between gap-2 pt-6"
          dir="ltr"
          role="img"
          aria-label={ctx.t("مخطط سرعة السبرنتات", "Sprint velocity chart")}
        >
          {data.averageStoryPoints !== null && (
            <div
              className="absolute left-0 right-0 border-t-2 border-dashed border-accent/50 z-0 pointer-events-none"
              style={{ bottom: `${(data.averageStoryPoints / yMax) * 100}%` }}
            >
              <div className="absolute -top-5 right-0 text-[10px] font-bold text-accent bg-surface px-1 border border-line rounded">
                {ctx.t("المتوسط", "AVG")}
              </div>
            </div>
          )}

          {data.series.map((sprint) => {
            const heightPercent = (sprint.completedStoryPoints / yMax) * 100;
            return (
              <div
                key={sprint.sprintId}
                tabIndex={0}
                aria-label={`${sprint.name}: ${fmtNumber(sprint.completedStoryPoints, ctx.locale)} ${ctx.t("نقطة مكتملة", "completed points")}`}
                className="group relative flex flex-1 flex-col items-center justify-end h-full z-10 focus-visible:outline-none"
              >
                <div className="pointer-events-none absolute -top-12 z-20 flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <div
                    dir={ctx.locale === "ar" ? "rtl" : "ltr"}
                    className="whitespace-nowrap rounded-lg bg-surface border border-line p-2 text-center text-xs text-ink shadow-xl"
                  >
                    <div className="font-bold">{sprint.name}</div>
                    <div className="text-[11px] text-ink-soft">
                      {fmtNumber(sprint.completedStoryPoints, ctx.locale)} {ctx.t("نقطة", "pts")} •{" "}
                      {fmtNumber(sprint.completedTaskCount, ctx.locale)} {ctx.t("مهمة", "tasks")}
                    </div>
                  </div>
                </div>

                <div
                  className="w-full max-w-12 rounded-t-sm bg-accent transition-all group-hover:brightness-110 group-focus-within:brightness-110"
                  style={{ height: `${heightPercent}%`, minHeight: sprint.completedStoryPoints > 0 ? "4px" : "0" }}
                />

                <div
                  className="mt-3 w-full truncate text-center text-[10px] font-medium text-ink-faint"
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
        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-ink-faint">
          <IconList size={16} />
          {ctx.t("بيانات السرعة التاريخية", "Historical Velocity Data")}
        </h4>

        {/* Mobile Cards */}
        <div className="grid gap-2 md:hidden">
          {[...data.series].reverse().map((sprint) => (
            <article key={sprint.sprintId} className="rounded-xl border border-line bg-raised/50 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-ink">{sprint.name}</span>
                <span className="text-[11px] text-ink-faint tabular-nums">
                  {sprint.completedAt
                    ? new Date(sprint.completedAt).toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US")
                    : "—"}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-ink-faint">{ctx.t("السرعة", "Velocity")}:</span>
                <span className="font-bold mono text-accent">
                  {fmtNumber(sprint.completedStoryPoints, ctx.locale)} pts
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-ink-faint">{ctx.t("الإنتاجية", "Throughput")}:</span>
                <span className="font-bold mono text-ink">
                  {fmtNumber(sprint.completedTaskCount, ctx.locale)} {ctx.t("مهام", "tasks")}
                </span>
              </div>
            </article>
          ))}
        </div>

        {/* Desktop Table */}
        <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
          <table className="w-full text-left text-sm text-ink-soft rtl:text-right">
            <thead className="border-b border-line bg-raised text-[11px] font-semibold uppercase text-ink-faint">
              <tr>
                <th className="px-5 py-3">{ctx.t("السبرنت", "Sprint")}</th>
                <th className="px-5 py-3">{ctx.t("تاريخ الاكتمال", "Completed Date")}</th>
                <th className="px-5 py-3 text-right rtl:text-left">{ctx.t("السرعة (نقاط)", "Velocity (Pts)")}</th>
                <th className="px-5 py-3 text-right rtl:text-left">
                  {ctx.t("الإنتاجية (مهام)", "Throughput (Tasks)")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-surface">
              {[...data.series].reverse().map((sprint) => (
                <tr key={sprint.sprintId} className="hover:bg-raised/50">
                  <td className="px-5 py-3 font-medium text-ink">{sprint.name}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {sprint.completedAt
                      ? new Date(sprint.completedAt).toLocaleDateString(ctx.locale === "ar" ? "ar-SA" : "en-US")
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-right rtl:text-left font-bold mono text-accent">
                    {fmtNumber(sprint.completedStoryPoints, ctx.locale)}
                  </td>
                  <td className="px-5 py-3 text-right rtl:text-left font-bold mono text-ink">
                    {fmtNumber(sprint.completedTaskCount, ctx.locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
