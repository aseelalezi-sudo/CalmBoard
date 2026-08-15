import Link from "next/link";
import { LogoMark, IconDatabase, IconUsers, IconLayers, IconRocket, IconBolt, IconShield } from "@/components/icons";
import { SecurityTestRunner } from "@/components/security-test-runner";
import { AdminControls } from "@/components/admin-controls";
import { getAdminOverview } from "@/features/admin/server-api";
import { fmtNumber } from "@/lib/types";

export const dynamic = "force-dynamic";

function planLabel(plan: string) {
  const labels: Record<string, string> = {
    free: "مجانية",
    starter: "مبتدئة",
    pro: "احترافية",
    business: "أعمال",
    enterprise: "مؤسسات",
  };
  return labels[plan.toLowerCase()] ?? "غير معروفة";
}

export default async function AdminPage() {
  const overview = await getAdminOverview();
  const {
    users,
    organizations: orgs,
    workspaces,
    projects,
    tasks,
    docs,
    goals,
    automations,
    forms,
    timeLogs,
    activities,
    invoices,
  } = overview.counts;
  const orgRows = overview.organizations;
  const stats = [
    { label: "المستخدمون", value: users, Icon: IconUsers, tone: "text-accent" },
    {
      label: "المؤسسات",
      value: orgs,
      Icon: IconLayers,
      tone: "text-violet-600 dark:text-violet-300",
    },
    {
      label: "مساحات العمل",
      value: workspaces,
      Icon: IconRocket,
      tone: "text-emerald-600 dark:text-emerald-300",
    },
    {
      label: "المشاريع",
      value: projects,
      Icon: IconLayers,
      tone: "text-amber-600 dark:text-amber-300",
    },
    { label: "المهام", value: tasks, Icon: IconBolt, tone: "text-violet-600 dark:text-violet-300" },
    { label: "المستندات", value: docs, Icon: IconDatabase, tone: "text-sky-600 dark:text-sky-300" },
    {
      label: "الأتمتة",
      value: automations,
      Icon: IconBolt,
      tone: "text-rose-600 dark:text-rose-300",
    },
    {
      label: "سجلات التدقيق",
      value: activities,
      Icon: IconShield,
      tone: "text-teal-600 dark:text-teal-300",
    },
  ];

  return (
    <div dir="rtl" className="min-h-screen app-bg text-ink">
      <div className="mx-auto max-w-[1100px] px-3 py-6 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={30} />
            <div>
              <h1 className="font-display text-[20px] font-bold text-ink">لوحة إدارة النظام</h1>
              <p className="text-[11.5px] text-ink-faint">الإدارة العليا · نظرة عامة على النظام</p>
            </div>
          </div>
          <span className="flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <IconShield size={12} />
            وصول مقيد · المصادقة الثنائية مطلوبة
          </span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
              <div className="flex items-start justify-between">
                <div className="mono text-[26px] font-bold text-ink tabular-nums">{fmtNumber(s.value, "ar")}</div>
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl border border-line bg-raised sm:h-9 sm:w-9 ${s.tone}`}
                >
                  <s.Icon size={15} />
                </span>
              </div>
              <div className="mt-2 text-[11px] font-semibold text-ink-faint">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
            <h2 className="text-[15px] font-semibold text-ink">المؤسسات والاشتراكات</h2>
            <div className="mt-4 space-y-3">
              {orgRows.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-raised/60 px-4 py-3.5"
                >
                  <div>
                    <div className="text-[13.5px] font-semibold text-ink">{o.name}</div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      <bdi>{o.slug}</bdi> · {fmtNumber(o.seats, "ar")} مقعد
                    </div>
                  </div>
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300">
                    {planLabel(o.plan)}
                  </span>
                </div>
              ))}
              {orgRows.length === 0 && (
                <p className="py-8 text-center text-[12.5px] text-ink-faint">لا توجد مؤسسات بعد</p>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-accent/25 bg-accent-soft p-5">
              <div className="text-[11px] font-semibold text-accent">سجلات الفوترة</div>
              <div className="mono mt-2 text-[30px] font-bold text-ink tabular-nums">{fmtNumber(invoices, "ar")}</div>
              <div className="mt-1 text-[11px] text-ink-faint">فاتورة مسجلة في قاعدة البيانات</div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
              <div className="text-[11px] font-semibold text-ink-faint">بيانات تشغيلية موثوقة</div>
              <div className="mt-3 space-y-2.5 text-[12px]">
                {[
                  ["الأهداف", goals],
                  ["النماذج", forms],
                  ["سجلات الوقت", timeLogs],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-ink-soft">{k}</span>
                    <span className="font-mono font-semibold text-ink tabular-nums">{fmtNumber(Number(v), "ar")}</span>
                  </div>
                ))}
              </div>
            </div>
            <Link
              href="/"
              className="block min-h-10 rounded-xl border border-line bg-surface px-4 py-3 text-center text-[12.5px] font-medium text-ink-soft shadow-sm transition hover:bg-raised hover:text-ink focus-ring"
            >
              العودة إلى المنصة ←
            </Link>
          </div>
        </div>

        <SecurityTestRunner />
        <AdminControls />

        <p className="mt-8 text-center text-[10.5px] text-ink-faint">
          إدارة CalmBoard العليا · تُسجل جميع الإجراءات هنا في سجل التدقيق مع معرّف ترابط
        </p>
      </div>
    </div>
  );
}
