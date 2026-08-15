"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { IconBolt, IconCheck, IconDoc, IconLayers, IconPlus, IconShield, IconSparkle, IconX } from "@/components/icons";
import { areaCls, Btn } from "@/components/ui";
import type { AIActionProposal } from "./types";
import { cn } from "@/lib/utils";

type AIPanelProps = {
  open: boolean;
  onClose: () => void;
  input: string;
  setInput: (value: string) => void;
  result: string | null;
  error: string | null;
  loading: boolean;
  run: (action: string) => void;
  t: (arabic: string, english: string) => string;
  proposal: AIActionProposal | null;
  proposalLoading: boolean;
  canApprove: boolean;
  approve: () => void;
  reject: () => void;
};

export function AIPanel({
  open,
  onClose,
  input,
  setInput,
  result,
  error,
  loading,
  run,
  t,
  proposal,
  proposalLoading,
  canApprove,
  approve,
  reject,
}: AIPanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [proposal?.id]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-65 flex justify-end h-dvh">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dark:bg-zinc-950/60 animate-fade"
        onClick={onClose}
      />
      <div
        className="theme-adaptive-panel animate-slide relative flex w-full max-w-[430px] flex-col border-s border-slate-200 bg-white/98 text-slate-900 shadow-2xl dark:border-white/8 dark:bg-[#0d0d15]/98 dark:text-zinc-100"
        style={{ "--slide-x": "-32px" } as CSSProperties}
      >
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-indigo-100 bg-linear-to-r from-indigo-500/10 to-violet-500/10 px-5 dark:border-white/6 dark:from-indigo-500/15 dark:to-violet-400/10">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-white shadow-[0_0_16px_rgba(99,102,241,0.4)]">
              <IconSparkle size={16} />
            </span>
            <div>
              <div className="text-[13.5px] font-bold text-slate-900 dark:text-white">
                {t("مساعد CalmBoard", "CalmBoard AI")}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-zinc-500">
                {t("متعدد المزودين · آمن · خاص", "Multi-provider · Secure · Private")}
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("إغلاق", "Close")}
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 dark:text-zinc-500 dark:hover:bg-white/6 dark:hover:text-white"
          >
            <IconX size={15} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3.5 dark:border-violet-500/20 dark:bg-violet-500/6">
            <div className="flex items-center gap-2 text-[11.5px] font-semibold text-violet-700 dark:text-violet-200">
              <IconShield size={12} />
              {t("الخصوصية أولًا", "Privacy first")}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-500 dark:text-zinc-500">
              {t(
                "تُنقّح البيانات الحساسة قبل إرسالها للمزود، ولا ينفذ الذكاء الاصطناعي أي تغيير تلقائيًا.",
                "Sensitive data is redacted before provider calls, and AI never applies changes automatically.",
              )}
            </p>
          </div>

          <div>
            <label
              htmlFor="ai-request"
              className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-zinc-500"
            >
              {t("ماذا تريد أن تفعل؟", "What do you want to do?")}
            </label>
            <textarea
              id="ai-request"
              rows={3}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t(
                "مثال: لخص المهام المتأخرة لهذا الأسبوع واقترح خطة عمل…",
                "e.g. Summarize overdue tasks for this week and suggest an action plan…",
              )}
              className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-[12.5px] text-slate-900 outline-none transition focus:border-violet-500 focus:bg-white dark:border-white/10 dark:bg-white/4 dark:text-white dark:focus:border-violet-400"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Btn variant="glow" disabled={loading || !input.trim()} onClick={() => run("custom")}>
                <IconSparkle size={13} />
                {t("تشغيل", "Run")}
              </Btn>
              <Btn variant="outline" disabled={loading} onClick={() => run("summarize_tasks")}>
                <IconCheck size={13} />
                {t("تلخيص المهام", "Summarize")}
              </Btn>
              <Btn variant="outline" disabled={loading} onClick={() => run("exec_report")}>
                <IconCheck size={13} />
                {t("تقرير القيادة", "Exec report")}
              </Btn>
              <Btn variant="outline" disabled={loading} onClick={() => run("meeting_notes")}>
                <IconCheck size={13} />
                {t("مهام الاجتماع", "Meeting notes")}
              </Btn>
            </div>
          </div>

          {(loading || result || error) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-white/8 dark:bg-white/3">
              {loading ? (
                <div className="flex items-center gap-3 text-[12.5px] text-slate-600 dark:text-zinc-400">
                  <span className="h-4 w-4 animate-spin-slow rounded-full border-2 border-violet-500 border-t-transparent" />
                  {t("يفكّر…", "Thinking…")}
                </div>
              ) : error ? (
                <div className="text-[12.5px] leading-relaxed text-rose-600 dark:text-rose-300">{error}</div>
              ) : (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-600">
                    {t("النتيجة", "Result")}
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700 dark:text-zinc-300">
                    {result}
                  </div>
                </>
              )}
            </div>
          )}

          {proposal && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-400/25 dark:bg-amber-400/6">
              <div className="flex items-center gap-2 text-[12px] font-bold text-amber-800 dark:text-amber-200">
                <IconShield size={14} />
                {t("مراجعة مطلوبة قبل التنفيذ", "Review required before execution")}
              </div>
              <p className="mt-1 text-[10.5px] leading-relaxed text-slate-600 dark:text-zinc-400">
                {t(
                  "لم تُنشأ أي مهمة بعد. راجع الاقتراح ثم وافق صراحةً أو ارفضه.",
                  "Nothing has been created. Review the proposal, then explicitly approve or reject it.",
                )}
              </p>
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                {proposal.tasks.map((task, index) => (
                  <div
                    key={`${proposal.id}-${index}`}
                    className="rounded-lg border border-amber-200 bg-white p-2.5 dark:border-white/8 dark:bg-white/4"
                  >
                    <div className="text-[11.5px] font-semibold text-slate-900 dark:text-zinc-100">{task.title}</div>
                    {task.description && (
                      <div className="mt-1 text-[10.5px] text-slate-600 dark:text-zinc-400">{task.description}</div>
                    )}
                    <div className="mt-1 text-[9.5px] uppercase tracking-wide text-slate-500 dark:text-zinc-500">
                      {task.priority}
                    </div>
                  </div>
                ))}
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10.5px] text-slate-700 dark:text-zinc-300">
                <input
                  name="auto-field-4wlrp3c"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-violet-600"
                />
                <span>
                  {t(
                    `راجعت المقترح وأوافق على إنشاء ${proposal.tasks.length} مهام`,
                    `I reviewed this proposal and approve creating ${proposal.tasks.length} tasks`,
                  )}
                </span>
              </label>
              {!canApprove && (
                <div className="mt-2 text-[10.5px] text-rose-600 dark:text-rose-300">
                  {t("ليس لديك صلاحية إنشاء المهام.", "You do not have permission to create tasks.")}
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Btn variant="glow" disabled={!confirmed || !canApprove || proposalLoading} onClick={approve}>
                  <IconCheck size={13} />
                  {t("موافقة وإنشاء", "Approve and create")}
                </Btn>
                <Btn variant="outline" disabled={proposalLoading} onClick={reject}>
                  <IconX size={13} />
                  {t("رفض", "Reject")}
                </Btn>
              </div>
            </section>
          )}
        </div>

        <footer className="border-t border-slate-200 p-4 text-[10.5px] text-slate-500 dark:border-white/6 dark:text-zinc-600">
          {t("تتطلب هذه الميزة إعداد مزود AI في الخادم", "This feature requires a server AI provider")}
        </footer>
      </div>
    </div>
  );
}
