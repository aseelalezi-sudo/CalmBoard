"use client";

import { use, useCallback } from "react";
import { LogoMark, IconCheck, IconSend } from "@/components/icons";
import { usePublicForm } from "@/features/forms/use-public-form";
import { visibleFormFields } from "@/features/forms/form-logic";
import { TurnstileWidget } from "@/features/forms/turnstile-widget";
import type { FormField } from "@/lib/types";

export default function PublicFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const {
    form,
    notFound,
    values,
    setValue,
    submitting,
    done,
    errors,
    submitError,
    setCaptchaToken,
    captchaResetKey,
    submit,
  } = usePublicForm(id);
  const handleCaptchaToken = useCallback((token: string) => setCaptchaToken(token), [setCaptchaToken]);

  if (notFound) {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">النموذج غير موجود</h1>
          <p className="mt-2 text-[13px] text-slate-500 dark:text-zinc-500">Form not found or link is invalid.</p>
        </div>
      </Shell>
    );
  }

  if (!form) {
    return (
      <Shell>
        <div className="space-y-4">
          <div className="skeleton h-8 w-2/3 rounded-xl" />
          <div className="skeleton h-4 w-1/2 rounded-lg" />
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
        </div>
      </Shell>
    );
  }

  if (!form.isActive) {
    return (
      <Shell>
        <div className="text-center">
          <h1 className="text-[20px] font-bold text-slate-900 dark:text-white">{form.name}</h1>
          <p className="mt-2 text-[13px] text-slate-500 dark:text-zinc-500">هذا النموذج لم يعد يستقبل الردود.</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-[0_0_30px_rgba(99,102,241,0.4)]">
            <IconCheck size={28} />
          </div>
          <h1 className="mt-5 text-[20px] font-bold text-slate-900 dark:text-white">شكراً! تم استلام ردك</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-500 dark:text-zinc-500">
            {form.successMessage ||
              (done.taskCreationStatus === "pending"
                ? "تم حفظ ردك، وتمت جدولة إنشاء المهمة ليتابعها الفريق."
                : "سيتم مراجعة ردك قريباً.")}
          </p>
        </div>
      </Shell>
    );
  }

  const visibleFields = visibleFormFields(form.fields, values);
  const captchaUnavailable = form.captcha.enabled && !form.captcha.configured;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-[22px] font-bold text-slate-900 dark:text-white">{form.name}</h1>
        {form.description && (
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-zinc-500">{form.description}</p>
        )}
      </div>

      <div className="space-y-4">
        {visibleFields.map((field) => (
          <PublicField
            key={field.id}
            field={field}
            value={values[field.id] ?? ""}
            error={errors[field.id]}
            onChange={(value) => setValue(field.id, value)}
          />
        ))}
      </div>

      {form.captcha.enabled && form.captcha.siteKey && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.025]">
          <TurnstileWidget siteKey={form.captcha.siteKey} resetKey={captchaResetKey} onToken={handleCaptchaToken} />
        </div>
      )}
      {captchaUnavailable && (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-center text-[12px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          التحقق الأمني غير مهيأ حالياً. تواصل مع مالك النموذج.
        </p>
      )}
      {submitError && (
        <p className="mt-4 rounded-xl bg-rose-50 p-3 text-center text-[12px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {submitError}
        </p>
      )}

      <button
        onClick={() => void submit()}
        disabled={submitting || captchaUnavailable}
        className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-[14px] font-semibold text-white shadow-[0_4px_20px_rgba(99,102,241,0.32)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <IconSend size={15} />
        {submitting ? "جاري الإرسال…" : form.submitLabel || "إرسال الرد"}
      </button>
      <p className="mt-4 text-center text-[10.5px] text-slate-400 dark:text-zinc-600">يعمل بواسطة CalmBoard Forms</p>
    </Shell>
  );
}

function PublicField({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const controlClass = `w-full rounded-xl border bg-white text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 dark:bg-white/[0.04] dark:text-white dark:placeholder:text-zinc-600 ${
    error
      ? "border-rose-400 focus:border-rose-500 dark:border-rose-500/60"
      : "border-slate-200 focus:border-indigo-500 dark:border-white/10 dark:focus:border-indigo-400/50"
  }`;
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-semibold text-slate-700 dark:text-zinc-300">
        {field.label} {field.required && <span className="text-rose-500 dark:text-rose-400">*</span>}
      </label>
      {field.description && <p className="mb-1.5 text-[11px] text-slate-500">{field.description}</p>}
      {field.type === "textarea" ? (
        <textarea
          name="auto-field-7fekouv"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${controlClass} min-h-[90px] p-3`}
          placeholder={field.placeholder || "اكتب هنا…"}
        />
      ) : field.type === "select" ? (
        <select
          name="auto-field-7198mm4"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${controlClass} h-10 px-3 dark:bg-zinc-900`}
        >
          <option value="">اختر…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "radio" ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.025]">
          {(field.options ?? []).map((option) => (
            <label key={option} className="flex items-center gap-2 text-[13px] text-slate-700 dark:text-zinc-300">
              <input
                type="radio"
                name={field.id}
                value={option}
                checked={value === option}
                onChange={() => onChange(option)}
              />
              {option}
            </label>
          ))}
        </div>
      ) : field.type === "checkbox" ? (
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-[13px] text-slate-700 dark:border-white/10 dark:bg-white/[0.025] dark:text-zinc-300">
          <input
            name="auto-field-m3qzn7u"
            type="checkbox"
            checked={value === "true"}
            onChange={(event) => onChange(String(event.target.checked))}
          />
          {field.placeholder || "نعم، أوافق"}
        </label>
      ) : (
        <input
          name="auto-field-cq4zabc"
          type={field.type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`${controlClass} h-10 px-3.5`}
          placeholder={field.placeholder || "اكتب هنا…"}
        />
      )}
      {error && (
        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
          {error === "required"
            ? "هذا الحقل مطلوب."
            : error === "email"
              ? "أدخل بريداً إلكترونياً صحيحاً."
              : "أدخل رقماً صحيحاً."}
        </p>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div dir="rtl" className="app-bg grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-[520px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark size={26} />
          <span className="font-display text-[16px] font-bold text-slate-900 dark:text-white">CalmBoard</span>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-xl backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0e0e16]/90 dark:shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
          {children}
        </div>
      </div>
    </div>
  );
}
