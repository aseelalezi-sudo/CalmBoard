"use client";

import { use, useCallback } from "react";
import { LogoMark, IconCheck, IconSend } from "@/components/icons";
import { usePublicForm } from "@/features/forms/use-public-form";
import { visibleFormFields } from "@/features/forms/form-logic";
import { TurnstileWidget } from "@/features/forms/turnstile-widget";
import type { FormField } from "@/lib/types";
import { Btn, ScreenState, areaCls, inputCls, selectCls } from "@/components/ui";

export default function PublicFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const {
    form,
    loading,
    notFound,
    loadError,
    retryLoad,
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
        <ScreenState
          tone="empty"
          framed={false}
          title="النموذج غير موجود"
          description="تعذر العثور على النموذج أو أن الرابط غير صالح. تحقق من الرابط المرسل إليك."
        />
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <ScreenState
          tone="error"
          framed={false}
          title="تعذر تحميل النموذج"
          description={loadError}
          action={<Btn onClick={retryLoad}>إعادة المحاولة</Btn>}
        />
      </Shell>
    );
  }

  if (loading || !form) {
    return (
      <Shell>
        <ScreenState tone="loading" framed={false} title="جارٍ تحميل النموذج…" />
      </Shell>
    );
  }

  if (!form.isActive) {
    return (
      <Shell>
        <ScreenState
          tone="permission"
          framed={false}
          title={form.name}
          description="هذا النموذج لم يعد يستقبل الردود. تواصل مع مالكه إذا كنت تحتاج إلى إرسال رد جديد."
        />
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent text-white shadow-lg">
            <IconCheck size={28} />
          </div>
          <h1 className="mt-5 text-[20px] font-bold text-ink">شكراً! تم استلام ردك</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
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
        <h1 className="text-[22px] font-bold text-ink">{form.name}</h1>
        {form.description && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{form.description}</p>}
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
        <div className="mt-5 rounded-xl border border-line bg-raised p-3">
          <TurnstileWidget siteKey={form.captcha.siteKey} resetKey={captchaResetKey} onToken={handleCaptchaToken} />
        </div>
      )}
      {captchaUnavailable && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-amber-500/10 p-3 text-center text-[12px] text-amber-700 dark:text-amber-300"
        >
          التحقق الأمني غير مهيأ حالياً. تواصل مع مالك النموذج.
        </p>
      )}
      {submitError && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-rose-500/10 p-3 text-center text-[12px] text-rose-700 dark:text-rose-300"
        >
          {submitError}
        </p>
      )}

      <Btn
        variant="glow"
        onClick={() => void submit()}
        disabled={submitting || captchaUnavailable}
        className="mt-6 w-full"
      >
        <IconSend size={15} />
        {submitting ? "جاري الإرسال…" : form.submitLabel || "إرسال الرد"}
      </Btn>
      <p className="mt-4 text-center text-[10.5px] text-ink-faint">يعمل بواسطة نماذج CalmBoard</p>
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
  const controlId = `public-form-${field.id}`;
  const descriptionId = field.description ? `${controlId}-description` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const fieldLabel = (
    <>
      {field.label} {field.required && <span className="text-rose-500 dark:text-rose-400">*</span>}
    </>
  );
  return (
    <div>
      {field.type === "radio" || field.type === "checkbox" ? (
        <p id={`${controlId}-label`} className="mb-1.5 text-[12px] font-semibold text-ink">
          {fieldLabel}
        </p>
      ) : (
        <label htmlFor={controlId} className="mb-1.5 block text-[12px] font-semibold text-ink">
          {fieldLabel}
        </label>
      )}
      {field.description && (
        <p id={descriptionId} className="mb-1.5 text-[11px] text-ink-soft">
          {field.description}
        </p>
      )}
      {field.type === "textarea" ? (
        <textarea
          id={controlId}
          name={field.id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={areaCls}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          placeholder={field.placeholder || "اكتب هنا…"}
        />
      ) : field.type === "select" ? (
        <select
          id={controlId}
          name={field.id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={selectCls}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
        >
          <option value="">اختر…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === "radio" ? (
        <div
          role="radiogroup"
          aria-labelledby={`${controlId}-label`}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className="space-y-2 rounded-xl border border-line bg-raised p-3"
        >
          {(field.options ?? []).map((option) => (
            <label key={option} className="flex min-h-10 items-center gap-2 text-[13px] text-ink-soft">
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
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-raised p-3 text-[13px] text-ink-soft">
          <input
            id={controlId}
            name={field.id}
            type="checkbox"
            checked={value === "true"}
            onChange={(event) => onChange(String(event.target.checked))}
            aria-labelledby={`${controlId}-label`}
            aria-describedby={describedBy}
            aria-invalid={Boolean(error)}
          />
          {field.placeholder || "نعم، أوافق"}
        </label>
      ) : (
        <input
          id={controlId}
          name={field.id}
          type={field.type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputCls}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          placeholder={field.placeholder || "اكتب هنا…"}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
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
    <div dir="rtl" className="app-bg grid min-h-dvh place-items-center p-2 sm:p-4">
      <div className="w-full max-w-[520px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <LogoMark size={26} />
          <span className="font-display text-[16px] font-bold text-ink">CalmBoard</span>
        </div>
        <main className="rounded-2xl border border-line bg-surface/95 p-4 shadow-xl backdrop-blur-xl sm:p-6 dark:shadow-none">
          {children}
        </main>
      </div>
    </div>
  );
}
