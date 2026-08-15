"use client";

import { useState } from "react";
import type { Form, ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { Badge, Btn, Card, ScreenHeader, ScreenState, Toggle } from "@/components/ui";
import { IconChevron, IconForm, IconPlus, IconShare } from "@/components/icons";
import { FormBuilder } from "@/features/forms/form-builder";

export function FormsView({ ctx }: { ctx: ViewCtx }) {
  const [builder, setBuilder] = useState<{ form?: Form } | null>(null);
  const [pendingFormId, setPendingFormId] = useState<string | null>(null);

  const canManageForms = ctx.can("forms.manage");

  const copy = async (id: string) => {
    const url = typeof window !== "undefined" ? `${window.location.origin}/f/${id}` : `/f/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      ctx.notify(ctx.t("تم نسخ رابط النموذج ✓", "Form link copied ✓"));
    } catch {
      ctx.notify(ctx.t("تعذر نسخ الرابط", "Failed to copy link"), "error");
    }
  };

  return (
    <div className="screen-container-wide space-y-6">
      <ScreenHeader
        title={ctx.t("النماذج", "Forms")}
        description={ctx.t(
          "اجمع الردود بأمان وحوّلها إلى مهام وفق إعدادات كل نموذج",
          "Collect responses securely and convert them into tasks using each form's settings",
        )}
        actions={
          canManageForms ? (
            <Btn variant="glow" onClick={() => setBuilder({})}>
              <IconPlus size={15} />
              {ctx.t("نموذج جديد", "New form")}
            </Btn>
          ) : undefined
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {ctx.forms.map((form) => (
          <Card key={form.id} className={`bg-surface p-5 ${form.isActive ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-2">
              <span className="grid h-10 w-10 place-items-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                <IconForm size={16} />
              </span>
              <Toggle
                checked={form.isActive}
                disabled={!canManageForms || pendingFormId === form.id}
                ariaLabel={ctx.t("تفعيل النموذج", "Toggle form status")}
                onChange={async (value) => {
                  setPendingFormId(form.id);
                  try {
                    await ctx.toggleForm(form.id, value);
                  } finally {
                    setPendingFormId(null);
                  }
                }}
              />
            </div>
            <div className="mt-3.5 text-[14px] font-semibold text-ink">{form.name}</div>
            {form.description && (
              <div className="mt-0.5 line-clamp-1 text-[11.5px] text-ink-soft">{form.description}</div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-faint">
              <Badge tone="indigo">
                <span className="mono tabular">{fmtNumber(form.responses, ctx.locale)}</span> {ctx.t("رد", "responses")}
              </Badge>
              <Badge tone="neutral">
                <span className="mono tabular">{fmtNumber(form.fields?.length || 0, ctx.locale)}</span>{" "}
                {ctx.t("حقل", "fields")}
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
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-raised text-[11px] font-medium text-ink transition hover:bg-surface"
              >
                <IconChevron size={12} className="rotate-180 rtl:rotate-0" />
                {ctx.t("فتح", "Open")}
              </a>
              {canManageForms ? (
                <button
                  onClick={() => setBuilder({ form })}
                  className="h-8 rounded-lg border border-line bg-surface text-[11px] font-medium text-ink hover:bg-raised transition"
                >
                  {ctx.t("تعديل", "Edit")}
                </button>
              ) : (
                <div />
              )}
              <button
                onClick={() => void copy(form.id)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-linear-to-r from-indigo-500 to-violet-500 px-2 text-[11px] font-semibold text-white shadow-sm transition hover:brightness-105"
              >
                <IconShare size={12} />
                {ctx.t("نسخ الرابط", "Copy link")}
              </button>
            </div>
          </Card>
        ))}
      </div>

      {ctx.forms.length === 0 && (
        <Card className="bg-surface">
          <ScreenState
            framed={false}
            tone="empty"
            title={ctx.t("لا نماذج بعد", "No forms yet")}
            description={ctx.t(
              "أنشئ نموذجاً لاستقبال الطلبات وتحويلها إلى مهام",
              "Create a form to collect requests as tasks",
            )}
            action={
              canManageForms ? (
                <Btn variant="glow" onClick={() => setBuilder({})}>
                  <IconPlus size={14} />
                  {ctx.t("أول نموذج", "First form")}
                </Btn>
              ) : undefined
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
          onSave={async (input) => {
            if (builder.form) {
              await ctx.updateForm(builder.form.id, input);
            } else {
              await ctx.createForm(input);
            }
          }}
        />
      )}
    </div>
  );
}
