"use client";

import { Badge } from "./ui";
import { useAdminQueues } from "@/features/admin/hooks";

export function AdminControls() {
  const { jobs, counts, redis, loading, error, act } = useAdminQueues();

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.025] dark:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-bold text-slate-900 dark:text-white">مراقبة الطوابير والمهام الخلفية</h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
            تعرض هذه اللوحة الحالة الفعلية القادمة من BullMQ وRedis، وتنفذ الإجراءات عبر واجهة الإدارة المحمية.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void act("retry_all_failed")}
            disabled={loading || (counts?.failed ?? 0) === 0}
            className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-[12px] font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
          >
            🔄 إعادة محاولة الوظائف الفاشلة
          </button>
          <button
            onClick={() => void act("trigger_cleanup")}
            disabled={loading || redis?.available === false}
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            🧹 إطلاق تنظيف الملفات غير المرتبطة
          </button>
        </div>
      </div>

      {(error || redis?.available === false) && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error ?? `Redis غير متاح: ${redis?.error ?? "تعذر الاتصال بالطابور"}`}
        </div>
      )}

      {counts ? (
        <div className="mt-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          {[
            ["نشطة", counts.active, "text-indigo-600 dark:text-indigo-300"],
            ["مكتملة", counts.completed, "text-emerald-600 dark:text-emerald-300"],
            ["فاشلة", counts.failed, "text-rose-600 dark:text-rose-300"],
            ["مؤجلة", counts.delayed, "text-amber-600 dark:text-amber-300"],
            ["الإجمالي", counts.total, "text-slate-800 dark:text-white"],
          ].map(([label, value, tone]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className={`text-xl font-black ${tone}`}>{value}</div>
              <div className="text-[11px] text-slate-500 dark:text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      ) : (
        loading && (
          <p className="mt-6 text-center text-[12px] text-slate-500 dark:text-zinc-500">جارٍ تحميل حالة الطوابير…</p>
        )
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 dark:border-white/10">
        <table className="w-full min-w-[720px] text-start text-[13px]">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 dark:bg-white/[0.03] dark:text-zinc-500">
            <tr>
              <th className="p-3.5 text-start">Job ID</th>
              <th className="p-3.5 text-start">Queue</th>
              <th className="p-3.5 text-start">Task Name</th>
              <th className="p-3.5 text-start">Status</th>
              <th className="p-3.5 text-start">Duration</th>
              <th className="p-3.5 text-start">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-slate-50/60 dark:hover:bg-white/[0.02]">
                <td className="p-3.5 font-mono text-[12px] text-slate-500 dark:text-zinc-400">{job.id}</td>
                <td className="p-3.5">
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300">
                    {job.queue}
                  </span>
                </td>
                <td className="p-3.5 font-semibold text-slate-900 dark:text-white">
                  <div>{job.name}</div>
                  {job.error && (
                    <div className="mt-1 font-mono text-[11px] text-rose-600 dark:text-rose-400">{job.error}</div>
                  )}
                </td>
                <td className="p-3.5">
                  <Badge
                    tone={
                      job.status === "completed"
                        ? "emerald"
                        : job.status === "failed"
                          ? "rose"
                          : job.status === "active"
                            ? "cyan"
                            : "amber"
                    }
                  >
                    {job.status.toUpperCase()} (x{job.attempts})
                  </Badge>
                </td>
                <td className="p-3.5 font-mono text-[12px] text-slate-600 dark:text-zinc-400">
                  {job.durationMs ? `${job.durationMs}ms` : "—"}
                </td>
                <td className="p-3.5">
                  {job.status === "failed" && (
                    <button
                      onClick={() => void act("retry", job.id)}
                      disabled={loading}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300"
                    >
                      إعادة محاولة
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[12px] text-slate-500 dark:text-zinc-500">
                  لا توجد وظائف محفوظة في نطاق العرض الحالي
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
