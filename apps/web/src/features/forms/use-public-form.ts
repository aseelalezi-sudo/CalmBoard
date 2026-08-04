import { useEffect, useState } from "react";
import { getPublicForm, submitPublicForm, type PublicForm } from "@/features/forms/public-api";
import { validateVisibleFields } from "@/features/forms/form-logic";

export function usePublicForm(id: string) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ taskCreationStatus: "not_requested" | "pending" } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    getPublicForm(id)
      .then((loaded) => (loaded ? setForm(loaded) : setNotFound(true)))
      .catch(() => setNotFound(true));
  }, [id]);

  const setValue = (fieldId: string, value: string) => {
    setValues((previous) => ({ ...previous, [fieldId]: value }));
    setErrors((previous) => {
      if (!previous[fieldId]) return previous;
      const next = { ...previous };
      delete next[fieldId];
      return next;
    });
  };

  const submit = async () => {
    if (!form) return;
    const validationErrors = validateVisibleFields(form.fields, values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length) return;
    if (form.captcha.enabled && !captchaToken) {
      setSubmitError("أكمل التحقق الأمني قبل الإرسال.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await submitPublicForm(form.id, values, captchaToken);
      setDone({ taskCreationStatus: result.taskCreationStatus });
    } catch (error) {
      setCaptchaToken("");
      setCaptchaResetKey((value) => value + 1);
      setSubmitError(error instanceof Error ? error.message : "تعذر إرسال النموذج. حاول مرة أخرى.");
    } finally {
      setSubmitting(false);
    }
  };

  return {
    form,
    notFound,
    values,
    setValue,
    submitting,
    done,
    errors,
    submitError,
    captchaToken,
    setCaptchaToken,
    captchaResetKey,
    submit,
  };
}
