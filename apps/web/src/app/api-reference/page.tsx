"use client";
import Link from "next/link";
import { useState } from "react";
import { LogoMark, IconShield, IconCode, IconDoc, IconCheck, IconChevron } from "@/components/icons";
import { Btn, Badge, Card } from "@/components/ui";
import { useOpenApiDocument, type OpenApiOperation } from "@/features/api-docs/use-openapi-document";

export default function ApiReferencePage() {
  const { document: spec, loading } = useOpenApiDocument();
  const [selectedPath, setSelectedPath] = useState<string>("/tasks");
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen app-bg grid place-items-center p-6 text-slate-900 dark:text-white">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500 text-white animate-pulse">
            <LogoMark size={28} />
          </div>
          <p className="mt-4 text-sm text-slate-500 dark:text-zinc-400">جاري تحميل وثائق OpenAPI 3.0 التفاعلية...</p>
        </div>
      </div>
    );
  }

  const paths = spec ? Object.keys(spec.paths) : [];
  const activeMethod = spec && spec.paths[selectedPath] ? Object.keys(spec.paths[selectedPath])[0] : "get";
  const activeEndpoint: OpenApiOperation | null =
    spec && spec.paths[selectedPath] ? spec.paths[selectedPath][activeMethod] : null;

  const copySpec = () => {
    navigator.clipboard?.writeText(JSON.stringify(spec, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div dir="rtl" className="min-h-screen app-bg text-slate-900 dark:text-zinc-100">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-6 backdrop-blur-xl dark:border-white/[0.06] dark:bg-[#0a0a11]/90">
        <div className="flex items-center gap-3">
          <LogoMark size={30} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[16px] font-bold text-slate-900 dark:text-white">
                وثائق الـ REST API (OpenAPI 3.0 Reference)
              </h1>
              <Badge tone="indigo">v2.0.0</Badge>
              <Badge tone="cyan">Multi-Tenant Secured</Badge>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-zinc-500">
              القسم 3 & 31: توثيق رسمي موحد لمعمارية الـ REST API و HMAC Signatures
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copySpec}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100 px-3 py-1.5 text-[12px] font-semibold text-slate-700 hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/10 transition"
          >
            {copied ? <IconCheck size={14} className="text-emerald-500" /> : <IconCode size={14} />}
            <span>{copied ? "تم النسخ ✓" : "تحميل الـ OpenAPI JSON"}</span>
          </button>
          <Link
            href="/"
            className="rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-1.5 text-[12px] font-bold text-white shadow-sm transition hover:brightness-110"
          >
            العودة للتطبيق ←
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] px-6 py-8">
        <div className="mb-8 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/80 to-violet-50/50 p-6 dark:border-indigo-500/25 dark:from-indigo-500/[0.12] dark:to-violet-500/[0.06]">
          <div className="flex items-center gap-2 text-[14px] font-bold text-indigo-900 dark:text-white">
            <IconShield size={18} className="text-indigo-600 dark:text-violet-300" />
            <span>معمارية الأمان والتحقق من التواقيع (Security & Authentication Architecture)</span>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-zinc-300">
            تتم حماية جميع نقاط النهاية في منصة <span className="font-bold">CalmBoard</span> عبر فحص الصلاحيات بالخادم
            (Server-Side RBAC Enforcement) مع فرض الـ{" "}
            <span className="font-mono bg-white/60 dark:bg-black/30 px-1 rounded">organizationId</span> في كل استعلام
            لمنع تسرب بيانات المستأجرين. بالنسبة للتكاملات الخارجية والـ Webhooks، يتم التحقق من صحة التوقيع عبر رأس{" "}
            <span className="font-mono font-bold text-indigo-700 dark:text-violet-300">x-calmboard-signature</span>{" "}
            باستخدام خوارزمية <span className="font-bold">HMAC SHA-256</span>.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="emerald">Authentication: Bearer JWT / Refresh Rotation</Badge>
            <Badge tone="violet">Webhook Auth: HMAC SHA-256 Signature</Badge>
            <Badge tone="cyan">Tenant Scoping: Mandatory RLS & WHERE Clause</Badge>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* Endpoint Selector Sidebar */}
          <aside className="space-y-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/[0.07] dark:bg-white/[0.02] dark:shadow-none h-fit">
            <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
              نقاط النهاية (Endpoints)
            </div>
            {paths.map((p) => {
              const m = Object.keys(spec?.paths[p] ?? {})[0];
              const isSelected = selectedPath === p;
              return (
                <button
                  key={p}
                  onClick={() => setSelectedPath(p)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start text-[13px] font-medium transition ${
                    isSelected
                      ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
                  }`}
                >
                  <span className="font-mono truncate">{p}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${m === "get" ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300" : "bg-indigo-500/20 text-indigo-800 dark:text-indigo-300"}`}
                  >
                    {m}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Endpoint Detail View */}
          {activeEndpoint && (
            <div className="space-y-6 animate-fade">
              <Card className="p-6 bg-white dark:bg-white/[0.02]" glow>
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 pb-4 dark:border-white/[0.06]">
                  <span
                    className={`rounded-xl px-3 py-1 font-mono text-[14px] font-extrabold uppercase ${activeMethod === "get" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300"}`}
                  >
                    {activeMethod}
                  </span>
                  <h2 className="font-mono text-[20px] font-bold text-slate-900 dark:text-white">{selectedPath}</h2>
                </div>
                <h3 className="mt-4 text-[16px] font-bold text-slate-800 dark:text-zinc-100">
                  {activeEndpoint.summary}
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-slate-600 dark:text-zinc-300">
                  {activeEndpoint.description}
                </p>

                {activeEndpoint.parameters && activeEndpoint.parameters.length > 0 && (
                  <div className="mt-6">
                    <h4 className="text-[13px] font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      معاملات الاستعلام (Query Parameters)
                    </h4>
                    <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                      <table className="w-full text-start text-[12.5px]">
                        <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 dark:bg-white/[0.03] dark:text-zinc-400">
                          <tr>
                            <th className="p-3 text-start">الاسم (Name)</th>
                            <th className="p-3 text-start">النوع (Type)</th>
                            <th className="p-3 text-start">إلزامي (Required)</th>
                            <th className="p-3 text-start">الوصف (Description)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                          {activeEndpoint.parameters.map((param: any) => (
                            <tr key={param.name}>
                              <td className="p-3 font-mono font-bold text-indigo-600 dark:text-violet-300">
                                {param.name}
                              </td>
                              <td className="p-3 font-mono text-slate-500 dark:text-zinc-400">
                                {param.schema?.type} {param.schema?.format ? `(${param.schema.format})` : ""}
                              </td>
                              <td className="p-3">
                                <Badge tone={param.required ? "rose" : "neutral"}>
                                  {param.required ? "نعم" : "اختياري"}
                                </Badge>
                              </td>
                              <td className="p-3 text-slate-600 dark:text-zinc-300">{param.description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeEndpoint.requestBody && (
                  <div className="mt-6">
                    <h4 className="text-[13px] font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      جسم الطلب (Request Body JSON)
                    </h4>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-[13px] text-emerald-300 dark:border-white/10 dark:bg-zinc-950">
                      {JSON.stringify(
                        activeEndpoint.requestBody.content["application/json"]?.schema?.properties
                          ? Object.fromEntries(
                              Object.entries(
                                activeEndpoint.requestBody.content["application/json"].schema.properties,
                              ).map(([k, v]: any) => [k, v.example || `string (${v.type})`]),
                            )
                          : { action: "breakdown", text: "مثال للبيانات المرسلة" },
                        null,
                        2,
                      )}
                    </div>
                  </div>
                )}

                <div className="mt-6">
                  <h4 className="text-[13px] font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    استجابة الخادم الناجحة (200 OK Response)
                  </h4>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-[13px] text-cyan-300 dark:border-white/10 dark:bg-zinc-950">
                    {selectedPath === "/tasks" &&
                      activeMethod === "get" &&
                      JSON.stringify(
                        [
                          spec?.components.schemas.Task?.properties
                            ? Object.fromEntries(
                                Object.entries(spec.components.schemas.Task.properties).map(([k, v]) => [
                                  k,
                                  v.example || "value",
                                ]),
                              )
                            : {},
                        ],
                        null,
                        2,
                      )}
                    {selectedPath === "/integrations/sync" &&
                      JSON.stringify(
                        {
                          ok: true,
                          provider: "github",
                          account: { id: "123456", displayName: "CalmBoard Engineering" },
                          message: "github: OAuth connection verified",
                        },
                        null,
                        2,
                      )}
                    {selectedPath === "/admin/security-tests" &&
                      JSON.stringify(
                        {
                          summary: { total: 5, passed: 5, failed: 0, durationMs: 9 },
                          tests: [{ id: "tenant-isolation-1", status: "passed", latencyMs: 4 }],
                        },
                        null,
                        2,
                      )}
                    {selectedPath !== "/tasks" &&
                      selectedPath !== "/integrations/sync" &&
                      selectedPath !== "/admin/security-tests" &&
                      JSON.stringify({ ok: true, result: "تم تنفيذ العملية وحفظ التغييرات في PostgreSQL" }, null, 2)}
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
