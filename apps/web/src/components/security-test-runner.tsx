"use client";

import { IconCheck, IconShield, IconX } from "@/components/icons";
import { Btn } from "@/components/ui";
import { useSecurityTests } from "@/features/admin/hooks";
import { fmtNumber } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SecurityTestRunner() {
  const { loading, report, error, run: runTests } = useSecurityTests();

  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[16px] font-bold text-ink">حزمة الفحص الآلي للأمان وعزل المستأجرين</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-faint">
            فحص فعلي لسياسات RLS وعزل المؤسسات ومساحات العمل وسلامة سجل التدقيق والتحقق من توقيع HMAC SHA-256 عبر واجهة
            الإدارة المحمية.
          </p>
        </div>
        <Btn disabled={loading} aria-busy={loading} onClick={() => void runTests()}>
          <IconShield size={14} />
          {loading ? "جارٍ تشغيل الفحص…" : "تشغيل فحص الأمان"}
        </Btn>
      </div>

      {error && (
        <div
          className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3.5 text-[13px] text-rose-700 dark:text-rose-300"
          role="alert"
        >
          {error}
        </div>
      )}

      {report && (
        <div className="mt-6 space-y-4 animate-fade" aria-live="polite">
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border p-3.5 text-[12.5px]",
              report.summary.passed === report.summary.total
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
            )}
          >
            <span className="font-bold">
              النتيجة: {fmtNumber(report.summary.passed, "ar")} ناجح من {fmtNumber(report.summary.total, "ar")}
            </span>
            <span>
              الزمن:{" "}
              <span className="font-mono font-bold tabular-nums">
                {fmtNumber(report.summary.durationMs, "ar")} مللي ثانية
              </span>
            </span>
            <time dateTime={report.summary.timestamp}>
              {new Date(report.summary.timestamp).toLocaleTimeString("ar-u-nu-latn", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </time>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {report.tests.map((testResult) => {
              const passed = testResult.status === "passed";
              return (
                <article
                  key={testResult.id}
                  className={cn(
                    "rounded-xl border p-4",
                    passed ? "border-line bg-raised/50" : "border-rose-500/30 bg-rose-500/10",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[13px] font-bold text-ink">{testResult.name_ar}</h3>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        passed
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300",
                      )}
                    >
                      {passed ? <IconCheck size={10} /> : <IconX size={10} />}
                      {passed ? "ناجح" : "فشل"}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ink-faint" dir="ltr">
                    {testResult.category === "Security & Tenancy" ? "الأمان والعزل" : testResult.category} ·{" "}
                    {fmtNumber(testResult.latencyMs, "ar")} مللي ثانية
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">{testResult.details_ar}</p>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
