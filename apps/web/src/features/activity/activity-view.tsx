"use client";

import type { ViewCtx } from "@/lib/types";
import { Avatar, Badge, Btn, Card, ScreenHeader, ScreenState } from "@/components/ui";
import { IconClock, IconDatabase, IconGlobe, IconTrend } from "@/components/icons";

export function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function ActivityView({ ctx }: { ctx: ViewCtx }) {
  const canViewAudit = ctx.can("audit.view");
  const hasActivities = ctx.activities.length > 0;

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
        a.actor?.name || "System",
        a.action,
        a.entityType,
        a.entitySerial || "",
        a.ip || "",
        new Date(a.createdAt).toISOString(),
      ]
        .map(escapeCsvCell)
        .join(","),
    );
    const csv = "\uFEFF" + [head.map(escapeCsvCell).join(","), ...rows].join("\n");
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

  if (!canViewAudit) {
    return (
      <div className="screen-container-standard">
        <ScreenState
          tone="permission"
          title={ctx.t("غير مصرح بعرض سجل التدقيق", "Unauthorized to view audit trail")}
          description={ctx.t(
            "ليس لديك صلاحية كافية للاطلاع على سجل التدقيق الأمني ونشاط المؤسسة.",
            "You do not have sufficient permissions to view the security audit log and activity trail.",
          )}
        />
      </div>
    );
  }

  return (
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("سجل التدقيق الأمني والنشاط (Security Audit Trail)", "Security Audit Log & Activity Trail")}
        description={ctx.t(
          "تتبّع كامل لكل العمليات والتعديلات مع أرقام الـ IP (القسم 27)",
          "Full traceability of all operations, mutations and IPs (Section 27)",
        )}
        actions={
          canViewAudit ? (
            <div className="flex items-center gap-2">
              <Btn size="sm" variant="outline" disabled={!hasActivities} onClick={exportCsv}>
                <IconTrend size={13} />
                {ctx.t("تصدير CSV", "Export CSV")}
              </Btn>
              <Btn size="sm" variant="glow" disabled={!hasActivities} onClick={exportJson}>
                <IconDatabase size={13} />
                {ctx.t("تصدير JSON (للمراقبة)", "Export JSON (SIEM)")}
              </Btn>
            </div>
          ) : undefined
        }
      />

      <Card className="overflow-hidden bg-surface">
        <div className="divide-y divide-line">
          {ctx.activities.map((a) => (
            <div key={a.id} className="flex items-center gap-3.5 px-5 py-3.5 transition hover:bg-raised/50">
              <Avatar src={a.actor?.avatarUrl} name={a.actor?.name} size={32} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-relaxed text-ink">
                  <span className="font-bold text-ink">{a.actor?.name || ctx.t("النظام", "System")}</span>{" "}
                  {label(a.action)}{" "}
                  {a.entitySerial && (
                    <span className="mono rounded-md border border-line bg-raised px-1.5 py-0.5 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                      {a.entitySerial}
                    </span>
                  )}{" "}
                  <span className="font-semibold text-ink">{a.entityLabel}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                  <Badge tone="neutral" className="font-mono">
                    {a.action}
                  </Badge>
                  <span className="inline-flex items-center gap-1">
                    <IconClock size={12} />
                    <time dateTime={a.createdAt}>
                      {new Date(a.createdAt).toLocaleString(ctx.locale === "ar" ? "ar-EG" : "en-US")}
                    </time>
                  </span>
                  {a.ip && (
                    <span className="mono inline-flex items-center gap-1 rounded border border-line bg-raised px-1.5 py-0.5 text-ink-soft">
                      <IconGlobe size={11} /> IP: <bdi dir="ltr">{a.ip}</bdi>
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {ctx.activities.length === 0 && (
            <div className="p-6">
              <ScreenState
                framed={false}
                tone="empty"
                title={ctx.t("لا نشاط مسجل", "No activity logged")}
                description={ctx.t(
                  "ستظهر جميع الأحداث والعمليات الأمنية هنا تلقائياً",
                  "All events and security operations will appear here automatically",
                )}
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
