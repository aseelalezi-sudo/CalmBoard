import { useEffect, useState } from "react";
import { getPublicForm, submitPublicForm, type PublicForm } from "@/features/forms/public-api";
import { validateVisibleFields } from "@/features/forms/form-logic";
import { ApiError } from "@/lib/client-api";

export function usePublicForm(id: string) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ taskCreationStatus: "not_requested" | "pending" } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);

    getPublicForm(id)
      .then((loaded) => {
        if (!current) return;
        if (loaded) {
          setForm(loaded);
        } else {
          setNotFound(true);
        }
      })
      .catch((error) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          setLoadError(error instanceof Error ? error.message : "تعذر تحميل النموذج. حاول مجدداً.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [id, reloadKey]);

  const retryLoad = () => setReloadKey((value) => value + 1);

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
    captchaToken,
    setCaptchaToken,
    captchaResetKey,
    submit,
  };
}
