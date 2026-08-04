import Link from "next/link";
import { LogoMark, IconDatabase, IconUsers, IconLayers, IconRocket, IconBolt, IconShield } from "@/components/icons";
import { SecurityTestRunner } from "@/components/security-test-runner";
import { AdminControls } from "@/components/admin-controls";
import { getAdminOverview } from "@/features/admin/server-api";

export const dynamic = "force-dynamic";

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
    { label: "المستخدمون", en: "Users", value: users, Icon: IconUsers, tone: "text-indigo-600 dark:text-indigo-300" },
    {
      label: "المؤسسات",
      en: "Organizations",
      value: orgs,
      Icon: IconLayers,
      tone: "text-violet-600 dark:text-violet-300",
    },
    {
      label: "مساحات العمل",
      en: "Workspaces",
      value: workspaces,
      Icon: IconRocket,
      tone: "text-emerald-600 dark:text-emerald-300",
    },
    {
      label: "المشاريع",
      en: "Projects",
      value: projects,
      Icon: IconLayers,
      tone: "text-amber-600 dark:text-amber-300",
    },
    { label: "المهام", en: "Tasks", value: tasks, Icon: IconBolt, tone: "text-violet-600 dark:text-violet-300" },
    { label: "المستندات", en: "Docs", value: docs, Icon: IconDatabase, tone: "text-sky-600 dark:text-sky-300" },
    {
      label: "الأتمتة",
      en: "Automations",
      value: automations,
      Icon: IconBolt,
      tone: "text-rose-600 dark:text-rose-300",
    },
    {
      label: "سجلات التدقيق",
      en: "Audit entries",
      value: activities,
      Icon: IconShield,
      tone: "text-teal-600 dark:text-teal-300",
    },
  ];

  return (
    <div dir="rtl" className="min-h-screen app-bg text-slate-900 dark:text-zinc-100">
      <div className="mx-auto max-w-[1100px] px-6 py-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LogoMark size={30} />
            <div>
              <h1 className="font-display text-[20px] font-bold text-slate-900 dark:text-white">لوحة إدارة النظام</h1>
              <p className="text-[11.5px] text-slate-500 dark:text-zinc-500">Super Admin · System Overview</p>
            </div>
          </div>
          <span className="flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            <IconShield size={12} />
            وصول مقيد · 2FA مطلوب
          </span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.en}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.025] dark:shadow-none"
            >
              <div className="flex items-start justify-between">
                <div className="mono text-[26px] font-bold text-slate-900 dark:text-white tabular">{s.value}</div>
                <span
                  className={`grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.04] ${s.tone}`}
                >
                  <s.Icon size={15} />
                </span>
              </div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                {s.label} · {s.en}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.025] dark:shadow-none">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">المؤسسات والاشتراكات</h2>
            <div className="mt-4 space-y-3">
              {orgRows.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3.5 dark:border-white/[0.06] dark:bg-white/[0.02]"
                >
                  <div>
                    <div className="text-[13.5px] font-semibold text-slate-900 dark:text-zinc-100">{o.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-500">
                      {o.slug} · {o.seats} مقعد
                    </div>
                  </div>
                  <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-semibold text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300">
                    {o.plan}
                  </span>
                </div>
              ))}
              {orgRows.length === 0 && (
                <p className="py-8 text-center text-[12.5px] text-slate-500 dark:text-zinc-600">لا توجد مؤسسات بعد</p>
              )}
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-500/25 dark:bg-indigo-500/[0.07]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                سجلات الفوترة
              </div>
              <div className="mono mt-2 text-[30px] font-bold text-slate-900 dark:text-white tabular">{invoices}</div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500">فاتورة مسجلة في قاعدة البيانات</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.025] dark:shadow-none">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                بيانات تشغيلية موثوقة
              </div>
              <div className="mt-3 space-y-2.5 text-[12px]">
                {[
                  ["الأهداف", goals],
                  ["النماذج", forms],
                  ["سجلات الوقت", timeLogs],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-zinc-400">{k}</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-white">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <Link
              href="/"
              className="block rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-[12.5px] font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:shadow-none dark:hover:bg-white/[0.08]"
            >
              العودة إلى المنصة ←
            </Link>
          </div>
        </div>

        <SecurityTestRunner />
        <AdminControls />

        <p className="mt-8 text-center text-[10.5px] text-slate-500 dark:text-zinc-600">
          CalmBoard Super Admin · جميع الإجراءات هنا تُسجل في سجل التدقيق مع Correlation ID
        </p>
      </div>
    </div>
  );
}
