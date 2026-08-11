"use client";

import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconRocket, IconX } from "@/components/icons";
import { Btn } from "@/components/ui";
import { getOnboardingProgress, updateOnboardingProgress, type OnboardingProgress, type OnboardingStep } from "./api";

type Props = {
  organizationId?: string;
  workspaceId?: string;
  userId?: string;
  t: (ar: string, en: string) => string;
  onCreateProject: () => void;
  onCreateTask: () => void;
  onInvite: () => void;
  onExploreBoard: () => void;
};

export function OnboardingChecklist(props: Props) {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [pending, setPending] = useState(false);
  const scope = useMemo(
    () =>
      props.organizationId && props.workspaceId && props.userId
        ? {
            organizationId: props.organizationId,
            workspaceId: props.workspaceId,
            userId: props.userId,
            actorId: props.userId,
          }
        : null,
    [props.organizationId, props.workspaceId, props.userId],
  );

  useEffect(() => {
    if (!scope) {
      setProgress(null);
      return;
    }
    let disposed = false;
    void getOnboardingProgress(scope)
      .then((value) => {
        if (!disposed) setProgress(value);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [scope]);

  if (!scope || !progress || progress.completedAt) return null;

  const complete = async (step: OnboardingStep, action: () => void) => {
    action();
    if (progress.completedSteps.includes(step)) return;
    setPending(true);
    try {
      setProgress(
        await updateOnboardingProgress(scope, {
          completedSteps: [...progress.completedSteps, step],
          dismissed: false,
        }),
      );
    } finally {
      setPending(false);
    }
  };

  const setDismissed = async (dismissed: boolean) => {
    setPending(true);
    try {
      setProgress(await updateOnboardingProgress(scope, { dismissed }));
    } finally {
      setPending(false);
    }
  };

  if (progress.dismissedAt) {
    return (
      <div className="mb-4 flex justify-end">
        <Btn size="sm" variant="outline" disabled={pending} onClick={() => void setDismissed(false)}>
          <IconRocket size={13} /> {props.t("استئناف الإعداد", "Resume setup")}
        </Btn>
      </div>
    );
  }

  const steps: Array<{ id: OnboardingStep; ar: string; en: string; action: () => void }> = [
    { id: "workspace_ready", ar: "فتح مساحة العمل", en: "Open workspace", action: () => undefined },
    { id: "project_created", ar: "إنشاء أول مشروع", en: "Create first project", action: props.onCreateProject },
    { id: "task_created", ar: "إنشاء أول مهمة", en: "Create first task", action: props.onCreateTask },
    { id: "teammate_invited", ar: "دعوة أول زميل", en: "Invite first teammate", action: props.onInvite },
    { id: "board_explored", ar: "استكشاف اللوحة", en: "Explore Board", action: props.onExploreBoard },
  ];
  const completed = progress.completedSteps.length;

  return (
    <section
      aria-label={props.t("قائمة بدء الاستخدام", "Getting started checklist")}
      className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/[0.06]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{props.t("ابدأ بسرعة", "Get started")}</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-zinc-400">
            {completed}/{steps.length} ·{" "}
            {props.t("خطوات عملية للوصول إلى القيمة الأولى", "A few practical steps to first value")}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => void setDismissed(true)}
          aria-label={props.t("إخفاء قائمة البدء", "Dismiss checklist")}
          className="rounded-lg p-1 text-slate-500 hover:bg-white/70 dark:hover:bg-white/10"
        >
          <IconX size={15} />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step) => {
          const done = progress.completedSteps.includes(step.id);
          return (
            <button
              key={step.id}
              type="button"
              disabled={pending || done}
              onClick={() => void complete(step.id, step.action)}
              className="flex items-center gap-2 rounded-xl border border-white/80 bg-white/80 px-3 py-2 text-start text-xs font-semibold text-slate-700 transition hover:border-indigo-300 disabled:opacity-70 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full ${done ? "bg-emerald-500 text-white" : "border border-slate-300 dark:border-zinc-600"}`}
              >
                {done && <IconCheck size={12} />}
              </span>
              {props.t(step.ar, step.en)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
