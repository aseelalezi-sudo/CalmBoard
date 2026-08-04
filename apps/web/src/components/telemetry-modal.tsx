"use client";
import React, { useState, useEffect } from "react";
import { Modal, Btn, Badge, Bar } from "./ui";
import { IconShield, IconDatabase, IconClock, IconSparkle, IconCheck, IconCode } from "./icons";

type LogEntry = {
  id: string;
  time: string;
  level: "INFO" | "WARN" | "DEBUG" | "TRACE";
  service: string;
  message: string;
  correlationId: string;
  durationMs: number;
};

const initialLogs: LogEntry[] = [
  {
    id: "log_1",
    time: "12:00:00",
    level: "INFO",
    service: "tenant-middleware",
    message: "Tenant organizationId & workspaceId scoping verified for request /api/tasks",
    correlationId: "req-94a8c1",
    durationMs: 2.1,
  },
  {
    id: "log_2",
    time: "11:59:57",
    level: "DEBUG",
    service: "database",
    message: "SELECT * FROM tasks WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY order ASC",
    correlationId: "req-94a8c1",
    durationMs: 3.8,
  },
  {
    id: "log_3",
    time: "11:59:52",
    level: "INFO",
    service: "bullmq-worker",
    message: "Job ProcessWhenIfThenRule completed successfully on queue automation-engine",
    correlationId: "job-8820a9",
    durationMs: 142,
  },
  {
    id: "log_4",
    time: "11:59:45",
    level: "TRACE",
    service: "opentelemetry",
    message: "Span exported to collector: http_request_duration_seconds{method='GET',route='/api/workspaces'}",
    correlationId: "req-11b90d",
    durationMs: 1.5,
  },
  {
    id: "log_5",
    time: "11:59:35",
    level: "INFO",
    service: "rbac-policy",
    message: "Permission check passed for actor owner on resource manage_org",
    correlationId: "req-33c82e",
    durationMs: 0.9,
  },
];

export function TelemetryModal({
  open,
  onClose,
  t,
}: {
  open: boolean;
  onClose: () => void;
  t: (ar: string, en: string) => string;
}) {
  const [activeTab, setActiveTab] = useState<"metrics" | "logs" | "infra">("metrics");
  const [cacheHitRate, setCacheHitRate] = useState(94.8);
  const [activeConnections, setActiveConnections] = useState(6);
  const [latency, setLatency] = useState(4.2);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);

  // Simulate real-time metrics fluctuation
  useEffect(() => {
    if (!open) return;
    const i = setInterval(() => {
      setLatency((prev) => +(prev + (Math.random() * 0.8 - 0.4)).toFixed(1));
      setActiveConnections((prev) => Math.min(12, Math.max(3, prev + Math.floor(Math.random() * 3 - 1))));
      setCacheHitRate((prev) => +Math.min(99.5, Math.max(90.0, prev + (Math.random() * 0.4 - 0.2))).toFixed(1));
    }, 2500);
    return () => clearInterval(i);
  }, [open]);

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(
        "⚡ مراقب صحة النظام ومقاييس الأداء (OpenTelemetry & Telemetry Monitor)",
        "⚡ OpenTelemetry System Diagnostics & Performance",
      )}
      icon={<IconDatabase size={18} />}
      wide
    >
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        {/* Header summary info */}
        <div className="rounded-xl border border-indigo-200 bg-linear-to-r from-indigo-50/90 to-violet-50/60 p-4 dark:border-indigo-500/30 dark:from-indigo-500/10 dark:to-violet-500/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="live-dot h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[14px] font-bold text-slate-900 dark:text-white">
                  {t("جميع الخدمات التشغيلية تعمل بأقصى كفاءة", "All operational services running at peak performance")}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-slate-600 dark:text-zinc-300">
                {t(
                  "القسم 3 & 25 & 30: مراقبة فورية لزمن استجابة استعلامات PostgreSQL، معدل إصابة التخزين المؤقت في Redis، وأحداث OpenTelemetry الموزعة.",
                  "Section 3, 25 & 30: Real-time monitoring of PostgreSQL query latency, Redis cache hit rates, and distributed OpenTelemetry spans.",
                )}
              </p>
            </div>
            <Badge tone="emerald" className="px-2.5 py-1 text-[11px] font-bold">
              99.98% UPTIME
            </Badge>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex gap-2 border-b border-slate-200 pb-2 dark:border-white/10">
          {[
            ["metrics", "📊 مقاييس الأداء (Core Web Vitals & Latency)", "Performance Metrics"],
            ["logs", "📑 السجلات المنسقة (Structured Logs & Traces)", "Structured Logs"],
            ["infra", "🛠️ البنية التحتية والاتصالات (Infra & DB Pool)", "Infra & DB Pool"],
          ].map(([k, ar, en]) => (
            <button
              key={k}
              onClick={() => setActiveTab(k as any)}
              className={`rounded-xl px-3.5 py-2 text-[12.5px] font-semibold transition ${
                activeTab === k
                  ? "bg-linear-to-r from-indigo-500 to-violet-500 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/4 dark:text-zinc-400 dark:hover:bg-white/10"
              }`}
            >
              {t(ar, en)}
            </button>
          ))}
        </div>

        {/* Metrics Tab */}
        {activeTab === "metrics" && (
          <div className="space-y-4 animate-fade">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/2">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                  Postgres Query Latency
                </div>
                <div className="mono mt-1.5 text-2xl font-black text-indigo-600 dark:text-violet-300 tabular-nums">
                  {latency} ms
                </div>
                <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  ✓ ممتاز (&lt;10ms)
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/2">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                  Redis Cache Hit Rate
                </div>
                <div className="mono mt-1.5 text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {cacheHitRate}%
                </div>
                <div className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">5,420 hits / 10m</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/2">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                  Core Web Vitals (LCP)
                </div>
                <div className="mono mt-1.5 text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                  0.78 s
                </div>
                <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  ✓ سريع (&lt;1.2s)
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-white/10 dark:bg-white/2">
                <div className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400">
                  INP / Response Time
                </div>
                <div className="mono mt-1.5 text-2xl font-black text-violet-600 dark:text-violet-300 tabular-nums">
                  14 ms
                </div>
                <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  ✓ استجابة فورية
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/2">
              <h4 className="text-[14px] font-bold text-slate-900 dark:text-white mb-3">
                🛠️ تحسينات الأداء المفعلة (Performance Optimization Matrix — القسم 25):
              </h4>
              <div className="grid gap-3 sm:grid-cols-2 text-[12px]">
                {[
                  [
                    "Cursor & Pagination Ready",
                    "تصفح الجداول الكبيرة عبر الفهارس المحسنة Trigram Indexes دون مشاكل N+1 Queries.",
                  ],
                  [
                    "TanStack Virtualized Rendering",
                    "جاهزية عرض قائمة تضم 50,000 مهمة بسلاسة 60 FPS مع تحميل تدريجي Lazy Loading.",
                  ],
                  [
                    "Optimistic UI + Rollback",
                    "تحديث الواجهات فورياً عند السحب والإفلات والتراجع التلقائي السريع عند فشل الاتصال.",
                  ],
                  [
                    "Distributed Query Caching",
                    "تخزين نتائج الاستعلامات الثقيلة في Redis ومزامنتها لحظياً عبر مساحات العمل.",
                  ],
                ].map(([title, desc], idx) => (
                  <div
                    key={idx}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-white/5 dark:bg-white/2"
                  >
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <IconCheck size={14} className="text-emerald-500" />
                      <span>{title}</span>
                    </div>
                    <p className="mt-1 text-slate-500 dark:text-zinc-400 text-[11.5px] leading-relaxed">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Structured Logs Tab */}
        {activeTab === "logs" && (
          <div className="space-y-3 animate-fade">
            <div className="flex items-center justify-between text-[12px] text-slate-500 dark:text-zinc-400 px-1">
              <span>بث السجلات بالوقت الحقيقي (Structured JSON Logs with Correlation ID — القسم 3 & 27):</span>
              <button
                onClick={() => {
                  const newLog: LogEntry = {
                    id: `log_${Date.now()}`,
                    time: new Date().toLocaleTimeString("ar-EG"),
                    level: "INFO",
                    service: "telemetry-monitor",
                    message: "Manual telemetry diagnostic check triggered by user",
                    correlationId: `req-${Math.random().toString(16).slice(2, 8)}`,
                    durationMs: +(Math.random() * 3 + 1).toFixed(1),
                  };
                  setLogs((prev) => [newLog, ...prev]);
                }}
                className="text-indigo-600 dark:text-violet-300 font-semibold hover:underline"
              >
                + توليد سجل اختبار مباشر ←
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-900 p-4 font-mono text-[12px] text-zinc-300 shadow-inner dark:border-white/10 dark:bg-zinc-950 max-h-80 overflow-y-auto space-y-2.5">
              {logs.map((lg) => (
                <div key={lg.id} className="border-b border-white/10 pb-2 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500">{lg.time}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 font-bold text-[10px] ${
                          lg.level === "INFO"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : lg.level === "DEBUG"
                              ? "bg-cyan-500/20 text-cyan-400"
                              : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        {lg.level}
                      </span>
                      <span className="font-bold text-indigo-400 dark:text-indigo-300">[{lg.service}]</span>
                    </div>
                    <span className="text-zinc-500">
                      duration: {lg.durationMs}ms | cid: <span className="text-amber-300">{lg.correlationId}</span>
                    </span>
                  </div>
                  <div className="mt-1 text-zinc-200 break-all leading-relaxed">{lg.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Infra Tab */}
        {activeTab === "infra" && (
          <div className="space-y-4 animate-fade">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/2">
              <h4 className="text-[15px] font-bold text-slate-900 dark:text-white mb-4">
                🖥️ البنية التحتية والاتصالات (DevOps & Docker Deployment Architecture — القسم 30):
              </h4>

              <div className="space-y-3">
                {[
                  [
                    "PostgreSQL 18 + Drizzle ORM Cluster",
                    "متصل (Healthy)",
                    "بركة اتصالات نشطة (Active Pool Connections: " +
                      activeConnections +
                      " / 20 Max). دعم UUIDv7 وسجلات التدقيق.",
                  ],
                  [
                    "Redis Cache & BullMQ Queue Gateway",
                    "متصل (Healthy)",
                    "استجابة فورية للأقفال الموزعة (Locks)، مؤشرات الحضور (Presence)، وطوابير الخلفية (Queues).",
                  ],
                  [
                    "S3-Compatible Storage (AWS S3 / Cloudflare R2 / MinIO)",
                    "جاهز (Ready)",
                    "توليد الروابط الموقعة Presigned URLs مع فحص أحجام الملفات ومحاكاة هوك مضاد الفيروسات.",
                  ],
                  [
                    "Next.js 16 App Router & Route Handlers Gateway",
                    "متصل (Healthy)",
                    "بنية Modular Monolith مستقلة قابلة للتحويل مستقبلاً إلى Microservices على Kubernetes.",
                  ],
                  [
                    "API Health Endpoint (:5500/health & Readiness)",
                    "متصل (Healthy)",
                    "فحص الدورية ومعدل استجابة 200 OK دائم مع مراقبة الصيانة التلقائية Zero-Downtime.",
                  ],
                ].map(([name, status, detail], idx) => (
                  <div
                    key={idx}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-white/5 dark:bg-white/2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 dark:text-white text-[13.5px]">{name}</span>
                        <Badge tone="emerald">{status}</Badge>
                      </div>
                      <p className="mt-1 text-slate-500 dark:text-zinc-400 text-[11.5px] leading-relaxed">{detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-[12px] text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200">
              💡 <span className="font-bold">ملاحظة تشغيلية:</span> يتم التحقق من جميع هذه الخدمات تلقائياً في خط أنابيب
              التكامل المستمر (CI Pipeline عبر GitHub Actions) مع تنفيذ فحص الـ ESLint، TypeCheck، والاختبارات الآلية
              قبل النشر.
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-white/10">
          <Btn variant="glow" onClick={onClose} className="px-6">
            <span>إغلاق المراقب ✓</span>
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
