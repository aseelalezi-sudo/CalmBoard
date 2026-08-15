"use client";

import { useEffect, useMemo, useState } from "react";
import { IconCheck, IconRocket, IconX } from "@/components/icons";
import { Btn, ScreenState } from "@/components/ui";
import { fmtNumber } from "@/lib/types";
import { getOnboardingProgress, updateOnboardingProgress, type OnboardingProgress, type OnboardingStep } from "./api";

type Props = {
  organizationId?: string;
  workspaceId?: string;
  userId?: string;
  progressKey: string;
  canCreateProject: boolean;
  canCreateTask: boolean;
  canInvite: boolean;
  t: (ar: string, en: string) => string;
  onCreateProject: () => void;
  onCreateTask: () => void;
  onInvite: () => void;
  onExploreBoard: () => void;
};

export function OnboardingChecklist({
  organizationId,
  workspaceId,
  userId,
  progressKey,
  canCreateProject,
  canCreateTask,
  canInvite,
  t,
  onCreateProject,
  onCreateTask,
  onInvite,
  onExploreBoard,
}: Props) {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [pending, setPending] = useState(false);

  const scope = useMemo(
    () =>
      organizationId && workspaceId && userId
        ? {
            organizationId,
            workspaceId,
            userId,
            actorId: userId,
          }
        : null,
    [organizationId, workspaceId, userId],
  );

  useEffect(() => {
    if (!scope) {
      setProgress(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let disposed = false;
    setLoading(true);
    setLoadError(null);
    void getOnboardingProgress(scope)
      .then((value) => {
        if (!disposed) {
          setProgress(value);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!disposed) {
          setLoadError(
            error instanceof Error ? error.message : t("تعذر تحميل خطوات البدء", "Failed to load onboarding checklist"),
          );
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [scope, progressKey, retryKey, t]);

  if (!scope) return null;

  if (loading) {
    return (
      <div className="mb-5">
        <ScreenState
          framed={false}
          tone="loading"
          title={t("جاري تحميل قائمة البدء…", "Loading getting started checklist…")}
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mb-5">
        <ScreenState
          framed={false}
          tone="error"
          title={t("تعذر تحميل قائمة البدء", "Failed to load getting started checklist")}
          description={loadError}
          action={
            <Btn size="sm" variant="outline" onClick={() => setRetryKey((value) => value + 1)}>
              {t("إعادة المحاولة", "Retry")}
            </Btn>
          }
        />
      </div>
    );
  }

  if (!progress || progress.completedAt) return null;

  const complete = async (step: OnboardingStep, action: () => void) => {
    action();
    if (progress.completedSteps.includes(step) || step !== "board_explored") return;
    setPending(true);
    setMutationError(null);
    try {
      setProgress(
        await updateOnboardingProgress(scope, {
          completedSteps: [...progress.completedSteps, step],
          dismissed: false,
        }),
      );
    } catch {
      setMutationError(t("تعذر تحديث حالة الخطوة", "Failed to update step progress"));
    } finally {
      setPending(false);
    }
  };

  const setDismissed = async (dismissed: boolean) => {
    setPending(true);
    setMutationError(null);
    try {
      setProgress(await updateOnboardingProgress(scope, { dismissed }));
    } catch {
      setMutationError(t("تعذر تحديث تفضيلات البدء", "Failed to update onboarding preference"));
    } finally {
      setPending(false);
    }
  };

  if (progress.dismissedAt) {
    return (
      <div className="mb-4 flex justify-end">
        <Btn
          size="sm"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void setDismissed(false)}
        >
          <IconRocket size={13} /> {t("استئناف الإعداد", "Resume setup")}
        </Btn>
      </div>
    );
  }

  const allSteps: Array<{ id: OnboardingStep; ar: string; en: string; available: boolean; action: () => void }> = [
    { id: "workspace_ready", ar: "فتح مساحة العمل", en: "Open workspace", available: true, action: () => undefined },
    {
      id: "project_created",
      ar: "إنشاء أول مشروع",
      en: "Create first project",
      available: canCreateProject,
      action: onCreateProject,
    },
    {
      id: "task_created",
      ar: "إنشاء أول مهمة",
      en: "Create first task",
      available: canCreateTask,
      action: onCreateTask,
    },
    {
      id: "teammate_invited",
      ar: "دعوة أول زميل",
      en: "Invite first teammate",
      available: canInvite,
      action: onInvite,
    },
    { id: "board_explored", ar: "استكشاف اللوحة", en: "Explore Board", available: true, action: onExploreBoard },
  ];

  const steps = allSteps.filter((step) => step.available || progress.completedSteps.includes(step.id));
  const completed = progress.completedSteps.filter((id) => steps.some((step) => step.id === id)).length;

  return (
    <section
      aria-label={t("قائمة بدء الاستخدام", "Getting started checklist")}
      className="mb-5 rounded-2xl border border-accent/25 bg-accent/5 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-ink">{t("ابدأ بسرعة", "Get started")}</h2>
          <p className="mt-1 text-xs text-ink-soft">
            {fmtNumber(completed, "ar")}/{fmtNumber(steps.length, "ar")} ·{" "}
            {t("خطوات عملية للوصول إلى القيمة الأولى", "A few practical steps to first value")}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => void setDismissed(true)}
          aria-label={t("إخفاء قائمة البدء", "Dismiss checklist")}
          className="rounded-lg p-1 text-ink-faint hover:bg-raised transition"
        >
          <IconX size={15} />
        </button>
      </div>

      {mutationError && (
        <p role="alert" className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
          {mutationError}
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {steps.map((step) => {
          const done = progress.completedSteps.includes(step.id);
          return (
            <button
              key={step.id}
              type="button"
              disabled={pending || done}
              aria-busy={pending}
              onClick={() => void complete(step.id, step.action)}
              className="min-h-10 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-start text-xs font-semibold text-ink transition hover:border-accent/40 disabled:opacity-70"
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${done ? "bg-emerald-500 text-white" : "border border-line"}`}
              >
                {done && <IconCheck size={12} />}
              </span>
              {t(step.ar, step.en)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
