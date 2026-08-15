"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconBell, IconCheck, IconShield, IconX } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

export type NoticeKind = "success" | "error" | "warning" | "info";

type NoticeOptions = {
  title?: string;
  duration?: number;
};

type Notice = NoticeOptions & {
  id: string;
  message: string;
  kind: NoticeKind;
};

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warning" | "default";
};

export type PromptOptions = {
  title: string;
  message?: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  required?: boolean;
  inputMode?: "text" | "url" | "numeric" | "decimal";
  type?: "text" | "password" | "url" | "date" | "number";
};

type DialogRequest =
  | { id: string; type: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { id: string; type: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

const feedbackEvent = "calmboard:feedback";
const dialogEvent = "calmboard:dialog";

function nextId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function notify(message: string, kind: NoticeKind = "success", options: NoticeOptions = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<Notice>(feedbackEvent, { detail: { id: nextId(), message: message.trim(), kind, ...options } }),
  );
}

export function confirmAction(options: ConfirmOptions) {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    window.dispatchEvent(
      new CustomEvent<DialogRequest>(dialogEvent, {
        detail: { id: nextId(), type: "confirm", options, resolve },
      }),
    );
  });
}

export function promptAction(options: PromptOptions) {
  if (typeof window === "undefined") return Promise.resolve<string | null>(null);
  return new Promise<string | null>((resolve) => {
    window.dispatchEvent(
      new CustomEvent<DialogRequest>(dialogEvent, {
        detail: { id: nextId(), type: "prompt", options, resolve },
      }),
    );
  });
}

const noticeStyles: Record<NoticeKind, string> = {
  success:
    "border-emerald-200/90 bg-white text-emerald-950 dark:border-emerald-400/25 dark:bg-[#15151f] dark:text-emerald-100",
  error: "border-rose-200/90 bg-white text-rose-950 dark:border-rose-400/30 dark:bg-[#15151f] dark:text-rose-100",
  warning: "border-amber-200/90 bg-white text-amber-950 dark:border-amber-400/30 dark:bg-[#15151f] dark:text-amber-100",
  info: "border-indigo-200/90 bg-white text-indigo-950 dark:border-indigo-400/25 dark:bg-[#15151f] dark:text-indigo-100",
};

const noticeAccent: Record<NoticeKind, string> = {
  success: "bg-emerald-500 text-white",
  error: "bg-rose-500 text-white",
  warning: "bg-amber-500 text-white",
  info: "bg-indigo-500 text-white",
};

function NoticeIcon({ kind }: { kind: NoticeKind }) {
  if (kind === "success") return <IconCheck size={15} />;
  if (kind === "error") return <IconX size={15} />;
  if (kind === "warning") return <span className="text-[14px] font-black">!</span>;
  return <IconBell size={15} />;
}

export function FeedbackHost() {
  const locale = useUiStore((state) => state.locale);
  const [mounted, setMounted] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const t = useCallback((ar: string, en: string) => (locale === "ar" ? ar : en), [locale]);

  useEffect(() => setMounted(true), []);

  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  useEffect(() => {
    const receiveNotice = (event: Event) => {
      const notice = (event as CustomEvent<Notice>).detail;
      if (!notice.message) return;
      setNotices((current) => [...current.filter((item) => item.message !== notice.message), notice].slice(-4));
      window.setTimeout(() => dismissNotice(notice.id), notice.duration ?? (notice.kind === "error" ? 7000 : 4500));
    };
    const receiveDialog = (event: Event) => {
      const request = (event as CustomEvent<DialogRequest>).detail;
      setDialog((current) => {
        if (current) {
          if (current.type === "confirm") current.resolve(false);
          else current.resolve(null);
        }
        return request;
      });
      setPromptValue(request.type === "prompt" ? (request.options.defaultValue ?? "") : "");
      setPromptError("");
    };
    window.addEventListener(feedbackEvent, receiveNotice);
    window.addEventListener(dialogEvent, receiveDialog);
    return () => {
      window.removeEventListener(feedbackEvent, receiveNotice);
      window.removeEventListener(dialogEvent, receiveDialog);
    };
  }, [dismissNotice]);

  const closeDialog = useCallback(() => {
    if (!dialog) return;
    if (dialog.type === "confirm") dialog.resolve(false);
    else dialog.resolve(null);
    setDialog(null);
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      if (dialog.type === "prompt") inputRef.current?.focus();
      else dialogRef.current?.querySelector<HTMLButtonElement>('[data-primary="true"]')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDialog, dialog]);

  const submitDialog = () => {
    if (!dialog) return;
    if (dialog.type === "confirm") {
      dialog.resolve(true);
      setDialog(null);
      return;
    }
    const value = promptValue.trim();
    if (dialog.options.required !== false && !value) {
      setPromptError(t("هذا الحقل مطلوب.", "This field is required."));
      inputRef.current?.focus();
      return;
    }
    dialog.resolve(value);
    setDialog(null);
  };

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <>
      <section
        aria-label={t("رسائل النظام", "System messages")}
        aria-live="polite"
        className="pointer-events-none fixed end-3 top-3 z-100 flex w-[min(390px,calc(100vw-24px))] flex-col gap-2 sm:end-5 sm:top-5"
      >
        {notices.map((notice) => (
          <article
            key={notice.id}
            role={notice.kind === "error" ? "alert" : "status"}
            className={cn(
              "feedback-notice pointer-events-auto relative overflow-hidden rounded-2xl border p-3.5 pe-10 shadow-[0_16px_48px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/5 dark:shadow-[0_20px_54px_rgba(0,0,0,0.58)] dark:ring-white/5",
              noticeStyles[notice.kind],
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-xl shadow-sm",
                  noticeAccent[notice.kind],
                )}
              >
                <NoticeIcon kind={notice.kind} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-[12px] font-bold">
                  {notice.title ??
                    (notice.kind === "success"
                      ? t("تم بنجاح", "Success")
                      : notice.kind === "error"
                        ? t("تعذر إكمال الإجراء", "Action failed")
                        : notice.kind === "warning"
                          ? t("تنبيه", "Warning")
                          : t("معلومة", "Information"))}
                </div>
                <p className="mt-0.5 break-words text-[12px] leading-5 opacity-80">{notice.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissNotice(notice.id)}
              aria-label={t("إغلاق الرسالة", "Dismiss message")}
              className="absolute end-2 top-2 grid h-7 w-7 place-items-center rounded-lg opacity-55 transition hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30 dark:hover:bg-white/8"
            >
              <IconX size={13} />
            </button>
            <span className={cn("absolute inset-x-0 bottom-0 h-0.5 opacity-70", noticeAccent[notice.kind])} />
          </article>
        ))}
      </section>

      {dialog && (
        <div className="fixed inset-0 z-110 grid place-items-center p-2 sm:p-4" role="presentation">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("إغلاق النافذة", "Close dialog")}
            className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-sm animate-fade dark:bg-black/70"
            onClick={closeDialog}
          />
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="animate-pop relative max-h-[calc(100dvh-1rem)] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-3xl border border-indigo-100 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.3)] dark:border-indigo-400/15 dark:bg-[#15151f] dark:shadow-[0_30px_90px_rgba(0,0,0,0.72)]"
          >
            <div className="flex items-start gap-3 border-b border-line px-5 py-4">
              <span
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                  dialog.type === "confirm" && dialog.options.tone === "danger"
                    ? "bg-rose-50 text-rose-600 dark:bg-rose-500/12 dark:text-rose-300"
                    : dialog.type === "confirm" && dialog.options.tone === "warning"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-500/12 dark:text-amber-300"
                      : "bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-300",
                )}
              >
                {dialog.type === "prompt" ? <IconBell size={18} /> : <IconShield size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-[15px] font-bold text-ink">
                  {dialog.options.title}
                </h2>
                {dialog.options.message && (
                  <p id={descriptionId} className="mt-1 text-[12.5px] leading-5 text-ink-soft">
                    {dialog.options.message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={closeDialog}
                aria-label={t("إغلاق", "Close")}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-ink-faint transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                <IconX size={14} />
              </button>
            </div>

            {dialog.type === "prompt" && (
              <div className="px-5 py-4">
                <label className="block text-[12px] font-semibold text-ink-soft" htmlFor={`${titleId}-input`}>
                  {dialog.options.label}
                </label>
                <input
                  ref={inputRef}
                  id={`${titleId}-input`}
                  type={dialog.options.type ?? "text"}
                  inputMode={dialog.options.inputMode}
                  value={promptValue}
                  placeholder={dialog.options.placeholder}
                  onChange={(event) => {
                    setPromptValue(event.target.value);
                    setPromptError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitDialog();
                    }
                  }}
                  aria-invalid={Boolean(promptError)}
                  aria-describedby={promptError ? `${titleId}-error` : undefined}
                  className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[13px] text-ink outline-none transition focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/15"
                />
                {promptError && (
                  <p
                    id={`${titleId}-error`}
                    role="alert"
                    className="mt-2 text-[11.5px] font-medium text-rose-600 dark:text-rose-300"
                  >
                    {promptError}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 bg-raised/60 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDialog}
                className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-semibold text-ink-soft transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
              >
                {dialog.options.cancelLabel ?? t("إلغاء", "Cancel")}
              </button>
              <button
                type="button"
                data-primary="true"
                onClick={submitDialog}
                className={cn(
                  "h-10 rounded-xl px-4 text-[12.5px] font-semibold text-white shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#15151f]",
                  dialog.type === "confirm" && dialog.options.tone === "danger"
                    ? "bg-rose-600 focus-visible:ring-rose-500"
                    : dialog.type === "confirm" && dialog.options.tone === "warning"
                      ? "bg-amber-600 focus-visible:ring-amber-500"
                      : "bg-indigo-600 focus-visible:ring-indigo-500",
                )}
              >
                {dialog.options.confirmLabel ?? t("متابعة", "Continue")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
