"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { notify } from "@/components/feedback";
import { IconCheck, IconCode, IconDoc, IconShield, LogoMark } from "@/components/icons";
import { Badge, Btn, Card, ScreenState } from "@/components/ui";
import {
  useOpenApiDocument,
  type OpenApiOperation,
  type OpenApiSchema,
} from "@/features/api-docs/use-openapi-document";

type OperationChoice = { path: string; method: string; operation: OpenApiOperation };

function methodClasses(method: string) {
  if (method === "get") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (method === "delete") return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  if (method === "patch" || method === "put") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-accent/15 text-accent";
}

function sampleForSchema(schema?: OpenApiSchema): unknown {
  if (!schema) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, sampleForSchema(value)]));
  }
  if (schema.type === "array") return [sampleForSchema(schema.items)];
  if (schema.format === "uuid") return "00000000-0000-4000-8000-000000000000";
  if (schema.format === "date-time") return "2026-08-15T12:00:00Z";
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return false;
  if (schema.$ref) return { المرجع: schema.$ref };
  return "نص";
}

export default function ApiReferencePage() {
  const { document: spec, loading, error, reload } = useOpenApiDocument();
  const [selection, setSelection] = useState({ path: "/tasks", method: "get" });
  const [copied, setCopied] = useState(false);

  const operations = useMemo<OperationChoice[]>(
    () =>
      Object.entries(spec?.paths ?? {}).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
      ),
    [spec],
  );

  useEffect(() => {
    if (!operations.length) return;
    if (!operations.some((item) => item.path === selection.path && item.method === selection.method)) {
      setSelection({ path: operations[0].path, method: operations[0].method });
    }
  }, [operations, selection.method, selection.path]);

  const active = operations.find((item) => item.path === selection.path && item.method === selection.method) ?? null;

  const copySpec = async () => {
    if (!spec) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopied(true);
      notify("تم نسخ ملف OpenAPI بصيغة JSON.");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify("تعذر نسخ ملف OpenAPI. تحقق من إذن الحافظة وحاول مجدداً.", "error");
    }
  };

  if (loading) {
    return (
      <main dir="rtl" className="grid min-h-dvh place-items-center app-bg p-4">
        <ScreenState
          tone="loading"
          title="جاري تحميل مرجع واجهة البرمجة…"
          description="يتم قراءة عقد OpenAPI الحالي من الخادم."
        />
      </main>
    );
  }

  if (error || !spec) {
    return (
      <main dir="rtl" className="grid min-h-dvh place-items-center app-bg p-4">
        <ScreenState
          tone="error"
          icon={<IconDoc size={20} />}
          title="تعذر تحميل مرجع واجهة البرمجة"
          description={error ?? "لم يُرجع الخادم وثيقة OpenAPI صالحة."}
          action={<Btn onClick={() => void reload()}>إعادة المحاولة</Btn>}
          className="w-full max-w-lg"
        />
      </main>
    );
  }

  return (
    <div dir="rtl" className="min-h-dvh app-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white">
              <LogoMark size={25} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[15px] font-bold text-ink sm:text-[16px]">مرجع واجهة برمجة التطبيقات</h1>
                {spec.info?.version && <Badge tone="indigo">الإصدار {spec.info.version}</Badge>}
                <Badge tone="cyan">OpenAPI 3.0</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                العقد الحالي لنقاط النهاية ومعاملاتها واستجاباتها الموثقة
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="outline" size="sm" disabled={!spec} onClick={() => void copySpec()}>
              {copied ? <IconCheck size={14} /> : <IconCode size={14} />}
              {copied ? "تم النسخ" : "نسخ OpenAPI JSON"}
            </Btn>
            <Link
              href="/"
              className="inline-flex min-h-10 items-center rounded-xl bg-accent px-4 text-[12px] font-bold text-white transition hover:brightness-110 focus-ring"
            >
              العودة إلى التطبيق
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-3 py-5 sm:px-6 sm:py-8">
        <section className="mb-6 rounded-2xl border border-accent/20 bg-accent/5 p-4 sm:p-6">
          <div className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <IconShield size={18} className="text-accent" />
            <h2>الأمان ونطاق الوصول</h2>
          </div>
          <p className="mt-2 max-w-4xl text-[13px] leading-6 text-ink-soft">
            تُطبّق المصادقة والصلاحيات وعزل المؤسسات في الخادم. وتستخدم التكاملات التي تستقبل خطافات ويب توقيع
            <bdi dir="ltr" className="mx-1 rounded bg-raised px-1.5 py-0.5 font-mono text-accent">
              x-calmboard-signature
            </bdi>
            وفق HMAC SHA-256. تعرض هذه الصفحة العقد الموثق فقط ولا ترسل طلبات تشغيلية.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="emerald">مصادقة وجلسات محمية</Badge>
            <Badge tone="violet">توقيع HMAC للخطافات</Badge>
            <Badge tone="cyan">عزل مؤسسات من جهة الخادم</Badge>
          </div>
        </section>

        {operations.length === 0 ? (
          <ScreenState
            icon={<IconDoc size={20} />}
            title="لا توجد نقاط نهاية موثقة"
            description="وثيقة OpenAPI الحالية لا تحتوي على عمليات قابلة للعرض."
          />
        ) : (
          <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="h-fit rounded-2xl border border-line bg-surface p-3 shadow-sm lg:sticky lg:top-24">
              <h2 className="mb-2 px-2 text-[11px] font-bold text-ink-faint">نقاط النهاية</h2>
              <nav
                aria-label="نقاط نهاية واجهة البرمجة"
                className="grid max-h-[40dvh] gap-1 overflow-y-auto lg:max-h-[calc(100dvh-9rem)]"
              >
                {operations.map((item) => {
                  const selected = item.path === selection.path && item.method === selection.method;
                  return (
                    <button
                      key={`${item.method}:${item.path}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelection({ path: item.path, method: item.method })}
                      className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-[12px] font-medium transition focus-ring ${
                        selected ? "bg-accent text-white shadow-sm" : "text-ink-soft hover:bg-raised hover:text-ink"
                      }`}
                    >
                      <bdi dir="ltr" className="truncate font-mono">
                        {item.path}
                      </bdi>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${selected ? "bg-white/15 text-white" : methodClasses(item.method)}`}
                      >
                        {item.method}
                      </span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            {active && <OperationDetails choice={active} />}
          </div>
        )}
      </main>
    </div>
  );
}

function OperationDetails({ choice }: { choice: OperationChoice }) {
  const { path, method, operation } = choice;
  const requestSchema = operation.requestBody?.content["application/json"]?.schema;
  const responses = Object.entries(operation.responses ?? {});

  return (
    <Card className="min-w-0 p-4 sm:p-6">
      <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-line pb-4">
        <span
          className={`rounded-lg px-2.5 py-1 font-mono text-[12px] font-extrabold uppercase ${methodClasses(method)}`}
        >
          {method}
        </span>
        <bdi dir="ltr" className="min-w-0 break-all font-mono text-[16px] font-bold text-ink sm:text-[20px]">
          {path}
        </bdi>
      </div>
      <h2 className="mt-4 text-[16px] font-bold text-ink">{operation.summary ?? "عملية موثقة"}</h2>
      {operation.description && <p className="mt-2 text-[13px] leading-6 text-ink-soft">{operation.description}</p>}

      {!!operation.parameters?.length && (
        <section className="mt-6">
          <h3 className="text-[13px] font-bold text-ink">معاملات الطلب</h3>
          <div className="mt-3 grid gap-2 md:hidden">
            {operation.parameters.map((parameter) => (
              <article key={parameter.name} className="rounded-xl border border-line bg-raised/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <bdi dir="ltr" className="font-mono text-[12px] font-bold text-accent">
                    {parameter.name}
                  </bdi>
                  <Badge tone={parameter.required ? "rose" : "neutral"}>
                    {parameter.required ? "إلزامي" : "اختياري"}
                  </Badge>
                </div>
                <p className="mt-2 text-[12px] text-ink-soft">{parameter.description ?? "لا يوجد وصف إضافي."}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-faint" dir="ltr">
                  {parameter.schema?.type ?? "unknown"}
                  {parameter.schema?.format ? ` (${parameter.schema.format})` : ""}
                </p>
              </article>
            ))}
          </div>
          <div className="mt-3 hidden overflow-x-auto rounded-xl border border-line md:block">
            <table className="w-full min-w-[560px] text-start text-[12px]">
              <thead className="bg-raised text-[11px] text-ink-faint">
                <tr>
                  <th className="p-3 text-start">الاسم</th>
                  <th className="p-3 text-start">النوع</th>
                  <th className="p-3 text-start">المتطلب</th>
                  <th className="p-3 text-start">الوصف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {operation.parameters.map((parameter) => (
                  <tr key={parameter.name}>
                    <td className="p-3 font-mono font-bold text-accent" dir="ltr">
                      {parameter.name}
                    </td>
                    <td className="p-3 font-mono text-ink-faint" dir="ltr">
                      {parameter.schema?.type ?? "unknown"}
                      {parameter.schema?.format ? ` (${parameter.schema.format})` : ""}
                    </td>
                    <td className="p-3">
                      <Badge tone={parameter.required ? "rose" : "neutral"}>
                        {parameter.required ? "إلزامي" : "اختياري"}
                      </Badge>
                    </td>
                    <td className="p-3 text-ink-soft">{parameter.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {requestSchema && <CodeSection title="مثال جسم الطلب" value={sampleForSchema(requestSchema)} />}

      <section className="mt-6">
        <h3 className="text-[13px] font-bold text-ink">الاستجابات الموثقة</h3>
        {responses.length ? (
          <div className="mt-3 grid gap-2">
            {responses.map(([status, response]) => (
              <div key={status} className="flex items-start gap-3 rounded-xl border border-line bg-raised/50 p-3">
                <Badge tone={status.startsWith("2") ? "emerald" : status.startsWith("4") ? "amber" : "rose"}>
                  {status}
                </Badge>
                <p className="text-[12px] leading-5 text-ink-soft">
                  {response.description ?? "استجابة موثقة دون وصف إضافي."}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-ink-faint">لم تُضف أوصاف الاستجابات إلى هذه العملية بعد.</p>
        )}
      </section>
    </Card>
  );
}

function CodeSection({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="mt-6 min-w-0">
      <h3 className="text-[13px] font-bold text-ink">{title}</h3>
      <pre
        dir="ltr"
        className="mt-3 max-w-full overflow-x-auto rounded-xl border border-line bg-slate-950 p-4 text-start font-mono text-[12px] leading-5 text-emerald-300"
      >
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </section>
  );
}
