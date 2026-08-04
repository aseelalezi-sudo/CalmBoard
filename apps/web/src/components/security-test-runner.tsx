"use client";
import { useSecurityTests } from "@/features/admin/hooks";

export function SecurityTestRunner() {
  const { loading, report, error, run: runTests } = useSecurityTests();

  return (
    <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.025] dark:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-bold text-slate-900 dark:text-white">
            حزمة فحص الأمان وعزل المستأجرين (Automated Security & Tenancy Suite)
          </h2>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
            تحقق مؤتمت فوري من سلامة العزل الأمني (RLS & Cross-Tenant)، سياسات RBAC، وتشفير التوقيع HMAC SHA-256 (قسم 26
            & 29).
          </p>
        </div>
        <button
          onClick={runTests}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2.5 text-[13px] font-semibold text-white shadow-md transition hover:brightness-105 disabled:opacity-50 dark:shadow-[0_0_20px_rgba(99,102,241,0.3)]"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>جاري الفحص الدقيق...</span>
            </>
          ) : (
            <>
              <span>🛡️ تشغيل فحص الأمان الآن</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-[13px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          ⚠️ {error}
        </div>
      )}

      {report && (
        <div className="mt-6 space-y-4 animate-fade">
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-[12.5px] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="font-bold">
              ✓ نتيجة الفحص: {report.summary.passed} ناجح / {report.summary.total} إجمالي
            </span>
            <span>
              • الزمن المستغرق: <span className="font-mono font-bold tabular-nums">{report.summary.durationMs}ms</span>
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              ({new Date(report.summary.timestamp).toLocaleTimeString("ar-EG")})
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {report.tests.map((t) => (
              <div
                key={t.id}
                className={`rounded-xl border p-4 transition ${
                  t.status === "passed"
                    ? "border-slate-200 bg-slate-50/50 dark:border-white/[0.06] dark:bg-white/[0.02]"
                    : "border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-slate-900 dark:text-zinc-100 text-[13px]">{t.name_ar}</div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      t.status === "passed"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300"
                    }`}
                  >
                    {t.status === "passed" ? "ناجح ✓" : "فشل ✕"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                  {t.category} · {t.latencyMs}ms
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-zinc-300">{t.details_ar}</p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-zinc-500">{t.details_en}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
