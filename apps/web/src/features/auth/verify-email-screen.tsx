"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/icons";
import { useUiStore } from "@/lib/stores/ui-store";
import { useAuthOperations } from "./use-auth-operations";

export function VerifyEmailScreen({ token }: { token: string }) {
  const { verifyEmail } = useAuthOperations();
  const locale = useUiStore((state) => state.locale);
  const t = (ar: string, en: string) => (locale === "ar" ? ar : en);
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function verify() {
    if (!token) {
      setStatus("error");
      setMessage(t("رابط التحقق غير مكتمل.", "Verification link is incomplete."));
      return;
    }
    setStatus("pending");
    try {
      await verifyEmail(token);
      setStatus("success");
      setMessage(t("تم التحقق من بريدك الإلكتروني بنجاح.", "Your email has been verified successfully."));
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t("تعذر التحقق من البريد.", "Could not verify email."));
    }
  }

  return (
    <AuthActionCard
      title={t("التحقق من البريد", "Verify email")}
      status={status}
      message={message}
      onAction={verify}
      action={t("تحقق الآن", "Verify now")}
      actionDisabled={!token}
    />
  );
}

export function AuthActionCard({
  title,
  status,
  message,
  action,
  actionForm,
  actionDisabled = false,
  onAction,
  children,
}: {
  title: string;
  status: "idle" | "pending" | "success" | "error";
  message: string;
  action: string;
  actionForm?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  const locale = useUiStore((state) => state.locale);
  const t = (ar: string, en: string) => (locale === "ar" ? ar : en);

  return (
    <main className="app-bg grid min-h-dvh place-items-center px-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <section className="w-full max-w-md rounded-3xl border border-line bg-surface p-7 text-center text-ink shadow-2xl">
        <div className="flex justify-center">
          <LogoMark size={44} />
        </div>
        <h1 className="mt-4 text-xl font-bold text-ink">{title}</h1>
        {children}
        {message && (
          <p
            role={status === "error" ? "alert" : "status"}
            aria-live={status === "error" ? "assertive" : "polite"}
            className={`mt-5 rounded-xl px-3 py-2 text-sm ${
              status === "error"
                ? "border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            }`}
          >
            {message}
          </p>
        )}
        {status !== "success" && (
          <button
            type={actionForm ? "submit" : "button"}
            form={actionForm}
            disabled={status === "pending" || actionDisabled}
            onClick={actionForm ? undefined : onAction}
            className="mt-6 h-11 w-full rounded-xl bg-linear-to-r from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-[0_6px_22px_rgba(99,102,241,0.25)] transition hover:opacity-95 disabled:opacity-50"
          >
            {status === "pending" ? t("جارٍ التنفيذ…", "Processing…") : action}
          </button>
        )}
        <Link href="/" className="mt-5 block text-xs font-semibold text-accent hover:underline">
          {t("العودة إلى CalmBoard", "Return to CalmBoard")}
        </Link>
      </section>
    </main>
  );
}
