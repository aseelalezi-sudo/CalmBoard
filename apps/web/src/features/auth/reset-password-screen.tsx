"use client";

import { useState, type FormEvent } from "react";
import { useUiStore } from "@/lib/stores/ui-store";
import { inputCls } from "@/components/ui";
import { useAuthOperations } from "./use-auth-operations";
import { AuthActionCard } from "./verify-email-screen";

export function ResetPasswordScreen({ token }: { token: string }) {
  const { resetPassword } = useAuthOperations();
  const locale = useUiStore((state) => state.locale);
  const t = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage(t("رابط إعادة التعيين غير مكتمل.", "Reset link is incomplete."));
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setStatus("error");
      setMessage(t("يجب أن تتراوح كلمة المرور بين 12 و 128 حرفاً.", "Password must be between 12 and 128 characters."));
      return;
    }
    if (password !== confirmation) {
      setStatus("error");
      setMessage(t("كلمتا المرور غير متطابقتين.", "Passwords do not match."));
      return;
    }
    setStatus("pending");
    try {
      await resetPassword(token, password);
      setStatus("success");
      setMessage(
        t(
          "تم تغيير كلمة المرور وإغلاق الجلسات القديمة.",
          "Password has been changed and previous sessions terminated.",
        ),
      );
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t("تعذر تغيير كلمة المرور.", "Could not change password."));
    }
  }

  return (
    <AuthActionCard
      title={t("إعادة تعيين كلمة المرور", "Reset password")}
      status={status}
      message={message}
      action={t("حفظ كلمة المرور الجديدة", "Save new password")}
      actionForm="reset-password-form"
      actionDisabled={!token || !password || !confirmation}
      onAction={() => void submit()}
    >
      {status !== "success" && (
        <form id="reset-password-form" onSubmit={submit} className="mt-5 space-y-4 text-start">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-xs font-semibold text-ink-soft">
              {t("كلمة المرور الجديدة", "New password")}
            </label>
            <input
              id="new-password"
              name="password"
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
              className={`${inputCls} h-11 text-sm`}
            />
          </div>
          <div>
            <label htmlFor="password-confirmation" className="mb-1 block text-xs font-semibold text-ink-soft">
              {t("تأكيد كلمة المرور", "Confirm password")}
            </label>
            <input
              id="password-confirmation"
              name="confirmation"
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="••••••••••••"
              className={`${inputCls} h-11 text-sm`}
            />
          </div>
        </form>
      )}
    </AuthActionCard>
  );
}
