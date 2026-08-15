"use client";

import { confirmAction } from "@/components/feedback";
import { IconBolt, IconTrend } from "@/components/icons";
import { Badge, Btn, ScreenState } from "@/components/ui";
import { useAdminQueues } from "@/features/admin/hooks";
import { fmtNumber } from "@/lib/types";

const statusLabel = (status: "active" | "completed" | "failed" | "delayed") =>
  ({ active: "نشطة", completed: "مكتملة", failed: "فاشلة", delayed: "مؤجلة" })[status];

const statusTone = (status: "active" | "completed" | "failed" | "delayed") =>
  status === "completed" ? "emerald" : status === "failed" ? "rose" : status === "active" ? "cyan" : "amber";

function durationLabel(durationMs?: number) {
  if (durationMs === undefined) return "—";
  return `${fmtNumber(durationMs, "ar", { maximumFractionDigits: 0 })} مللي ثانية`;
}

export function AdminControls() {
  const { jobs, counts, redis, loading, pendingAction, error, reload, act } = useAdminQueues();
  const busy = loading || pendingAction !== null;

  const triggerCleanup = async () => {
    const confirmed = await confirmAction({
      title: "تنظيف الملفات غير المرتبطة",
      message: "ستبدأ وظيفة خلفية لحذف الملفات التي أثبت الخادم أنها غير مرتبطة بسجلات نشطة.",
      confirmLabel: "إطلاق التنظيف",
      tone: "danger",
    });
    if (confirmed) await act("trigger_cleanup");
  };

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-[16px] font-bold text-ink">مراقبة الطوابير والمهام الخلفية</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-faint">
            حالة فعلية من BullMQ وRedis، وإجراءات إدارية تمر عبر واجهة الخادم المحمية وتُسجل في سجل التدقيق.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Btn
            variant="outline"
            disabled={busy || (counts?.failed ?? 0) === 0}
            aria-busy={pendingAction === "retry_all_failed"}
            onClick={() => void act("retry_all_failed")}
          >
            <IconTrend size={14} />
            إعادة محاولة الوظائف الفاشلة
          </Btn>
          <Btn
            disabled={busy || redis?.available === false}
            aria-busy={pendingAction === "trigger_cleanup"}
            onClick={() => void triggerCleanup()}
          >
            <IconBolt size={14} />
            تنظيف الملفات غير المرتبطة
          </Btn>
        </div>
      </div>

      {(error || redis?.available === false) && (
        <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4" role="alert">
          <p className="text-[12px] text-rose-700 dark:text-rose-300">
            {error ?? "خدمة الطوابير غير متاحة حالياً. لم تُنفذ أي عملية إدارية."}
          </p>
          <Btn className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>
            إعادة المحاولة
          </Btn>
        </div>
      )}

      {counts ? (
        <div className="mt-6 grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
          {[
            ["نشطة", counts.active, "text-accent"],
            ["مكتملة", counts.completed, "text-emerald-600 dark:text-emerald-300"],
            ["فاشلة", counts.failed, "text-rose-600 dark:text-rose-300"],
            ["مؤجلة", counts.delayed, "text-amber-600 dark:text-amber-300"],
            ["الإجمالي", counts.total, "text-ink"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-xl border border-line bg-raised p-3">
              <div className={`text-xl font-black tabular-nums ${tone}`}>{fmtNumber(Number(value), "ar")}</div>
              <div className="text-[11px] text-ink-faint">{label}</div>
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="mt-6">
          <ScreenState tone="loading" framed={false} className="py-6" title="جارٍ تحميل حالة الطوابير…" />
        </div>
      ) : null}

      <div className="mt-6 space-y-3 md:hidden">
        {jobs.map((job) => (
          <article key={job.id} className="rounded-xl border border-line bg-raised/50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{job.name}</div>
                <div className="mt-1 truncate font-mono text-[10.5px] text-ink-faint" dir="ltr">
                  {job.id}
                </div>
              </div>
              <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <dt className="text-ink-faint">الطابور</dt>
                <dd className="mt-0.5 truncate font-mono text-ink-soft" dir="ltr">
                  {job.queue}
                </dd>
              </div>
              <div>
                <dt className="text-ink-faint">المدة</dt>
                <dd className="mt-0.5 text-ink-soft">{durationLabel(job.durationMs)}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">المحاولات</dt>
                <dd className="mt-0.5 text-ink-soft">{fmtNumber(job.attempts, "ar")}</dd>
              </div>
            </dl>
            {job.status === "failed" && (
              <Btn
                className="mt-3"
                size="sm"
                variant="outline"
                disabled={busy}
                aria-busy={pendingAction === `retry:${job.id}`}
                onClick={() => void act("retry", job.id)}
              >
                إعادة محاولة
              </Btn>
            )}
          </article>
        ))}
      </div>

      <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-line md:block">
        <table className="w-full min-w-[720px] text-start text-[13px]">
          <thead className="bg-raised text-[11px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="p-3.5 text-start">معرّف الوظيفة</th>
              <th className="p-3.5 text-start">الطابور</th>
              <th className="p-3.5 text-start">اسم المهمة</th>
              <th className="p-3.5 text-start">الحالة</th>
              <th className="p-3.5 text-start">المدة</th>
              <th className="p-3.5 text-start">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-raised/60">
                <td className="p-3.5 font-mono text-[12px] text-ink-faint" dir="ltr">
                  {job.id}
                </td>
                <td className="p-3.5 font-mono text-[11px] text-accent" dir="ltr">
                  {job.queue}
                </td>
                <td className="p-3.5 font-semibold text-ink">
                  <div>{job.name}</div>
                  {job.error && (
                    <div className="mt-1 text-[11px] font-normal text-rose-600 dark:text-rose-300">
                      فشلت الوظيفة؛ راجع السجل المحمي للتفاصيل التقنية.
                    </div>
                  )}
                </td>
                <td className="p-3.5">
                  <Badge tone={statusTone(job.status)}>
                    {statusLabel(job.status)} · {fmtNumber(job.attempts, "ar")} محاولة
                  </Badge>
                </td>
                <td className="p-3.5 text-[12px] text-ink-soft">{durationLabel(job.durationMs)}</td>
                <td className="p-3.5">
                  {job.status === "failed" && (
                    <Btn
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-busy={pendingAction === `retry:${job.id}`}
                      onClick={() => void act("retry", job.id)}
                    >
                      إعادة محاولة
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
            {!loading && jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[12px] text-ink-faint">
                  لا توجد وظائف محفوظة في نطاق العرض الحالي
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!loading && jobs.length === 0 && (
        <p className="mt-4 text-center text-[12px] text-ink-faint md:hidden">
          لا توجد وظائف محفوظة في نطاق العرض الحالي
        </p>
      )}
    </section>
  );
}
