"use client";

import { useState } from "react";
import type { Form, ViewCtx } from "@/lib/types";
import { Badge, Btn, Card, Empty, Toggle } from "@/components/ui";
import { IconChevron, IconForm, IconPlus, IconShare } from "@/components/icons";
import { FormBuilder } from "@/features/forms/form-builder";

export function FormsView({ ctx }: { ctx: ViewCtx }) {
  const [builder, setBuilder] = useState<{ form?: Form } | null>(null);

  const copy = async (id: string) => {
    const url = `${window.location.origin}/f/${id}`;
    await navigator.clipboard?.writeText(url);
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">{ctx.t("النماذج", "Forms")}</h2>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
            {ctx.t(
              "اجمع الردود بأمان وحوّلها إلى مهام وفق إعدادات كل نموذج",
              "Collect responses securely and convert them into tasks using each form's settings",
            )}
          </p>
        </div>
        <Btn variant="glow" disabled={!ctx.can("forms.manage")} onClick={() => setBuilder({})}>
          <IconPlus size={15} />
          {ctx.t("نموذج جديد", "New form")}
        </Btn>
      </div>

      <div className="stagger grid gap-4 md:grid-cols-2">
        {ctx.forms.map((form) => (
          <Card key={form.id} className={`bg-white p-5 dark:bg-white/[0.025] ${form.isActive ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
                <IconForm size={16} />
              </span>
              <Toggle
                checked={form.isActive}
                disabled={!ctx.can("forms.manage")}
                onChange={(value) => ctx.toggleForm(form.id, value)}
              />
            </div>
            <div className="mt-3.5 text-[14px] font-semibold text-slate-900 dark:text-white">{form.name}</div>
            {form.description && (
              <div className="mt-0.5 line-clamp-1 text-[11.5px] text-slate-500 dark:text-zinc-500">
                {form.description}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500 dark:text-zinc-500">
              <Badge tone="indigo">
                <span className="mono tabular">{form.responses}</span> {ctx.t("رد", "responses")}
              </Badge>
              <Badge tone="neutral">
                <span className="mono tabular">{form.fields?.length || 0}</span> {ctx.t("حقل", "fields")}
              </Badge>
              {form.settings?.createTask && <Badge tone="emerald">{ctx.t("ينشئ مهمة", "creates task")}</Badge>}
              {form.settings?.captchaEnabled && <Badge tone="violet">CAPTCHA</Badge>}
              {form.fields.some((field) => field.condition) && (
                <Badge tone="amber">{ctx.t("منطق شرطي", "conditional")}</Badge>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <a
                href={`/f/${form.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 text-[11px] font-medium text-slate-700 transition hover:bg-slate-200 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
              >
                <IconChevron size={12} className="rotate-180 rtl:rotate-0" />
                {ctx.t("فتح", "Open")}
              </a>
              <button
                disabled={!ctx.can("forms.manage")}
                onClick={() => setBuilder({ form })}
                className="h-8 rounded-lg border border-slate-200 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                {ctx.t("تعديل", "Edit")}
              </button>
              <button
                onClick={() => void copy(form.id)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-2 text-[11px] font-semibold text-white"
              >
                <IconShare size={12} />
                {ctx.t("نسخ الرابط", "Copy link")}
              </button>
            </div>
          </Card>
        ))}
      </div>

      {ctx.forms.length === 0 && (
        <Card>
          <Empty
            icon={<IconForm size={22} />}
            title={ctx.t("لا نماذج بعد", "No forms yet")}
            hint={ctx.t(
              "أنشئ نموذجاً لاستقبال الطلبات وتحويلها إلى مهام",
              "Create a form to collect requests as tasks",
            )}
            action={
              <Btn variant="glow" disabled={!ctx.can("forms.manage")} onClick={() => setBuilder({})}>
                <IconPlus size={14} />
                {ctx.t("أول نموذج", "First form")}
              </Btn>
            }
          />
        </Card>
      )}

      {builder && (
        <FormBuilder
          form={builder.form}
          projects={ctx.projects}
          activeProjectId={ctx.activeProject?.id}
          t={ctx.t}
          onClose={() => setBuilder(null)}
          onSave={(input) => (builder.form ? ctx.updateForm(builder.form.id, input) : ctx.createForm(input))}
        />
      )}
    </div>
  );
}
