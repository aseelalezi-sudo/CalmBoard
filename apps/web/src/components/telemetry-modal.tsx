"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiServiceUrl, requestJson } from "@/lib/client-api";
import { Badge, Btn, Modal, ScreenState } from "./ui";
import { IconCheck, IconClock, IconDatabase, IconShield } from "./icons";

type ReadinessResponse = {
  ok: boolean;
  service: string;
  status: "ready";
  timestamp: string;
};

export function TelemetryModal({
  open,
  onClose,
  t,
}: {
  open: boolean;
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setFailed(false);
    try {
      const result = await requestJson<ReadinessResponse>(apiServiceUrl("/health/readiness"));
      if (requestId !== requestIdRef.current) return;
      if (!result.ok || result.status !== "ready") throw new Error("Service is not ready");
      setReadiness(result);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setReadiness(null);
      setFailed(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load, open]);

  const checkedAt = readiness?.timestamp
    ? new Date(readiness.timestamp).toLocaleString(
        typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar-u-nu-latn" : "en-US",
      )
    : "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("جاهزية خدمات CalmBoard", "CalmBoard service readiness")}
      description={t(
        "فحص مباشر للخدمات المطلوبة لاستقبال الطلبات، وليس لوحة قياسات أداء تاريخية.",
        "A live check of the services required to accept requests, not a historical performance dashboard.",
      )}
      icon={<IconDatabase size={18} />}
      size="wide"
      closeLabel={t("إغلاق", "Close")}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Btn variant="outline" onClick={onClose} className="w-full sm:w-auto">
            {t("إغلاق", "Close")}
          </Btn>
          <Btn variant="primary" onClick={() => void load()} disabled={loading} className="w-full sm:w-auto">
            <IconClock size={15} />
            {loading ? t("جارٍ الفحص…", "Checking…") : t("إعادة الفحص", "Check again")}
          </Btn>
        </div>
      }
    >
      {loading && !readiness && (
        <ScreenState
          tone="loading"
          framed={false}
          title={t("جارٍ التحقق من جاهزية الخدمات…", "Checking service readiness…")}
        />
      )}

      {!loading && failed && (
        <ScreenState
          tone="error"
          title={t("الخدمات غير جاهزة حالياً", "Services are not ready")}
          description={t(
            "تعذر الوصول إلى API أو أن إحدى تبعياته المطلوبة لا تستجيب. تحقق من تشغيل PostgreSQL وRedis وAPI ثم أعد الفحص.",
            "The API could not be reached or a required dependency is unavailable. Check PostgreSQL, Redis, and the API, then try again.",
          )}
          action={
            <Btn variant="outline" onClick={() => void load()} disabled={loading}>
              <IconClock size={15} />
              {t("إعادة المحاولة", "Try again")}
            </Btn>
          }
        />
      )}

      {readiness && (
        <div className="space-y-4" aria-live="polite">
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                  <IconCheck size={19} />
                </span>
                <div>
                  <h3 className="font-bold text-ink">{t("النظام جاهز لاستقبال الطلبات", "System is ready")}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-soft">
                    {t(
                      "أكد الخادم اتصال قاعدة البيانات واستجابة Redis ضمن مهلة فحص الجاهزية.",
                      "The server confirmed database connectivity and a Redis response within the readiness timeout.",
                    )}
                  </p>
                </div>
              </div>
              <Badge tone="emerald">{t("جاهز", "Ready")}</Badge>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-raised p-4">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <IconDatabase size={16} />
                {t("التبعيات المطلوبة", "Required dependencies")}
              </div>
              <p className="mt-2 text-xs leading-6 text-ink-soft">
                {t("PostgreSQL وRedis اجتازا الفحص المباشر.", "PostgreSQL and Redis passed the live check.")}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-raised p-4">
              <div className="flex items-center gap-2 font-semibold text-ink">
                <IconShield size={16} />
                {t("نطاق هذا الفحص", "Check scope")}
              </div>
              <p className="mt-2 text-xs leading-6 text-ink-soft">
                {t(
                  "يعرض الجاهزية الحالية فقط، ولا يخمّن زمن التشغيل أو زمن الاستجابة أو معدل إصابة التخزين المؤقت.",
                  "Shows current readiness only; it does not estimate uptime, latency, or cache hit rate.",
                )}
              </p>
            </div>
          </div>

          {checkedAt && (
            <p className="text-xs text-ink-faint">
              {t("وقت الفحص:", "Checked at:")} <time dateTime={readiness.timestamp}>{checkedAt}</time>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
