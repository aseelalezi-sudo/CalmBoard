"use client";

import { useState } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/icons";
import { useAuthOperations } from "./use-auth-operations";

export function VerifyEmailScreen({ token }: { token: string }) {
  const { verifyEmail } = useAuthOperations();
  const [status, setStatus] = useState<"idle" | "pending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function verify() {
    if (!token) {
      setStatus("error");
      setMessage("رابط التحقق غير مكتمل.");
      return;
    }
    setStatus("pending");
    try {
      await verifyEmail(token);
      setStatus("success");
      setMessage("تم التحقق من بريدك الإلكتروني بنجاح.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "تعذر التحقق من البريد.");
    }
  }

  return (
    <AuthActionCard title="التحقق من البريد" status={status} message={message} onAction={verify} action="تحقق الآن" />
  );
}

export function AuthActionCard({
  title,
  status,
  message,
  action,
  onAction,
  children,
}: {
  title: string;
  status: "idle" | "pending" | "success" | "error";
  message: string;
  action: string;
  onAction: () => void;
  children?: React.ReactNode;
}) {
  return (
    <main className="app-bg grid min-h-screen place-items-center px-4" dir="rtl">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white/95 p-7 text-center text-slate-900 shadow-2xl shadow-indigo-950/10 dark:border-white/10 dark:bg-[#101019]/95 dark:text-zinc-100 dark:shadow-black/30">
        <LogoMark size={44} />
        <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">{title}</h1>
        {children}
        {message && (
          <p
            className={`mt-5 rounded-xl px-3 py-2 text-sm ${status === "error" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}
          >
            {message}
          </p>
        )}
        {status !== "success" && (
          <button
            disabled={status === "pending"}
            onClick={onAction}
            className="mt-6 h-11 w-full rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-sm font-bold text-white shadow-[0_6px_22px_rgba(99,102,241,0.25)] disabled:opacity-60"
          >
            {status === "pending" ? "جارٍ التنفيذ…" : action}
          </button>
        )}
        <Link
          href="/"
          className="mt-5 block text-xs text-violet-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200"
        >
          العودة إلى CalmBoard
        </Link>
      </section>
    </main>
  );
}
