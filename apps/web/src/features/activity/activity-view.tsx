"use client";
import type { ViewCtx } from "@/lib/types";
import { Avatar, Badge, Btn, Card, Empty } from "@/components/ui";
import { IconClock, IconDatabase, IconTrend } from "@/components/icons";

/* ================= Activity / Audit View ================= */
export function ActivityView({ ctx }: { ctx: ViewCtx }) {
  const label = (a: string) =>
    a === "task.created"
      ? ctx.t("أنشأ", "created")
      : a === "task.updated"
        ? ctx.t("حدّث", "updated")
        : a === "comment.added"
          ? ctx.t("علّق على", "commented on")
          : a;
  const exportCsv = () => {
    const head = ["ID", "Actor", "Action", "EntityType", "EntitySerial", "IP", "Timestamp"];
    const rows = ctx.activities.map((a) =>
      [
        a.id,
        `"${(a.actor?.name || "System").replace(/"/g, '""')}"`,
        a.action,
        a.entityType,
        a.entitySerial || "",
        a.ip || "",
        new Date(a.createdAt).toISOString(),
      ].join(","),
    );
    const csv = "\uFEFF" + [head.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const lnk = document.createElement("a");
    lnk.href = URL.createObjectURL(blob);
    lnk.download = `audit-trail-${new Date().toISOString().split("T")[0]}.csv`;
    lnk.click();
    URL.revokeObjectURL(lnk.href);
    ctx.notify(ctx.t("تم تصدير سجل التدقيق CSV ✓", "Audit log CSV exported ✓"));
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(ctx.activities, null, 2)], { type: "application/json;charset=utf-8" });
    const lnk = document.createElement("a");
    lnk.href = URL.createObjectURL(blob);
    lnk.download = `audit-trail-${new Date().toISOString().split("T")[0]}.json`;
    lnk.click();
    URL.revokeObjectURL(lnk.href);
    ctx.notify(ctx.t("تم تصدير سجل التدقيق JSON ✓", "Audit log JSON exported ✓"));
  };

  return (
    <div className="max-w-[820px] mx-auto">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">
            {ctx.t("سجل التدقيق الأمني والنشاط (Security Audit Trail)", "Security Audit Log & Activity Trail")}
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
            {ctx.t(
              "تتبّع كامل لكل العمليات والتعديلات مع أرقام الـ IP (القسم 27)",
              "Full traceability of all operations, mutations and IPs (Section 27)",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Btn size="sm" variant="outline" onClick={exportCsv}>
            <IconTrend size={13} />
            {ctx.t("تصدير CSV", "Export CSV")}
          </Btn>
          <Btn size="sm" variant="glow" onClick={exportJson}>
            <IconDatabase size={13} />
            {ctx.t("تصدير JSON (للمراقبة)", "Export JSON (SIEM)")}
          </Btn>
        </div>
      </div>
      <Card className="overflow-hidden bg-white dark:bg-white/[0.025]">
        <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
          {ctx.activities.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3.5 px-5 py-3.5 transition hover:bg-slate-50/60 dark:hover:bg-white/[0.02]"
            >
              <Avatar src={a.actor?.avatarUrl} name={a.actor?.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-relaxed text-slate-600 dark:text-zinc-300">
                  <span className="font-bold text-slate-900 dark:text-white">{a.actor?.name || "النظام"}</span>{" "}
                  {label(a.action)}{" "}
                  {a.entitySerial && (
                    <span className="mono rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-indigo-600 dark:border-transparent dark:bg-white/[0.06] dark:text-violet-300">
                      {a.entitySerial}
                    </span>
                  )}{" "}
                  <span className="font-semibold text-slate-800 dark:text-zinc-200">{a.entityLabel}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 dark:text-zinc-500">
                  <Badge tone="neutral" className="font-mono">
                    {a.action}
                  </Badge>
                  <span>🕒 {new Date(a.createdAt).toLocaleString(ctx.locale === "ar" ? "ar-EG" : "en-US")}</span>
                  {a.ip && (
                    <span className="mono bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 rounded text-slate-600 dark:text-zinc-400">
                      🌐 IP: {a.ip}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {ctx.activities.length === 0 && (
            <Empty icon={<IconClock size={22} />} title={ctx.t("لا نشاط مسجل", "No activity logged")} />
          )}
        </div>
      </Card>
    </div>
  );
}
