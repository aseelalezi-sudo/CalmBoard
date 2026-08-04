"use client";

import { useState, type FormEvent } from "react";
import { useAuthOperations } from "./use-auth-operations";
import { AuthActionCard } from "./verify-email-screen";

export function ResetPasswordScreen({ token }: { token: string }) {
  const { resetPassword } = useAuthOperations();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("رابط إعادة التعيين غير مكتمل.");
      return;
    }
    setStatus("pending");
    try {
      await resetPassword(token, password);
      setStatus("success");
      setMessage("تم تغيير كلمة المرور وإغلاق الجلسات القديمة.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "تعذر تغيير كلمة المرور.");
    }
  }

  return (
    <AuthActionCard
      title="إعادة تعيين كلمة المرور"
      status={status}
      message={message}
      action="حفظ كلمة المرور الجديدة"
      onAction={() => void submit()}
    >
      {status !== "success" && (
        <form onSubmit={submit} className="mt-5">
          <input
            id="password"
            name="password"
            required
            minLength={12}
            maxLength={128}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="كلمة المرور الجديدة"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-violet-500 dark:border-white/10 dark:bg-white/4 dark:text-white dark:focus:border-violet-400/50"
          />
        </form>
      )}
    </AuthActionCard>
  );
}
