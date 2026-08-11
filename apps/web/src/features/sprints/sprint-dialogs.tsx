"use client";

import { useEffect, useMemo, useState } from "react";
import type { Sprint, Task, ViewCtx } from "@/lib/types";
import { fmtDate } from "@/lib/types";
import { Btn, Modal } from "@/components/ui";
import type { CompleteSprintDestination, SprintFormInput } from "./api";
import { sprintSummary, validateSprintForm } from "./sprint-domain";

const fieldClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-white";

function dateValue(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

export function SprintFormDialog({
  open,
  sprint,
  defaultName,
  ctx,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  sprint: Sprint | null;
  defaultName: string;
  ctx: ViewCtx;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: SprintFormInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(sprint?.name ?? defaultName);
    setGoal(sprint?.goal ?? "");
    setStartsAt(dateValue(sprint?.startsAt));
    setEndsAt(dateValue(sprint?.endsAt));
    setError("");
  }, [defaultName, open, sprint]);

  const submit = async () => {
    const input = { name: name.trim(), goal: goal.trim() || null, startsAt: startsAt || null, endsAt: endsAt || null };
    const validation = validateSprintForm(input);
    if (validation) {
      setError(
        validation === "name"
          ? ctx.t("اسم السبرنت مطلوب", "Sprint name is required")
          : validation === "range"
            ? ctx.t("تاريخ النهاية يجب ألا يسبق البداية", "End date cannot be before start date")
            : ctx.t("أدخل تاريخاً صالحاً", "Enter a valid date"),
      );
      return;
    }
    await onSubmit(input);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sprint ? ctx.t("تعديل السبرنت", "Edit Sprint") : ctx.t("إنشاء سبرنت", "Create Sprint")}
    >
      <div className="space-y-4">
        <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300">
          {ctx.t("اسم السبرنت", "Sprint name")}
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${fieldClass} mt-1.5`}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700 dark:text-zinc-300">
          {ctx.t("الهدف", "Goal")}
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={3}
            className={`${fieldClass} mt-1.5 resize-none`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700 dark:text-zinc-300">
            {ctx.t("البداية المخططة", "Planned start")}
            <input
              type="date"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className={`${fieldClass} mt-1.5`}
            />
          </label>
          <label className="text-sm font-medium text-slate-700 dark:text-zinc-300">
            {ctx.t("النهاية المخططة", "Planned end")}
            <input
              type="date"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              className={`${fieldClass} mt-1.5`}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 dark:border-white/8">
          <Btn variant="ghost" onClick={onClose}>
            {ctx.t("إلغاء", "Cancel")}
          </Btn>
          <Btn variant="primary" disabled={pending} onClick={() => void submit()}>
            {pending ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("حفظ", "Save")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

export function StartSprintDialog({ sprint, tasks, ctx, pending, onClose, onConfirm }: LifecycleDialogProps) {
  const summary = sprintSummary(tasks);
  return (
    <Modal open={Boolean(sprint)} onClose={onClose} title={ctx.t("بدء السبرنت", "Start Sprint")}>
      {sprint && (
        <div className="space-y-3 text-sm text-slate-600 dark:text-zinc-300">
          <h3 className="text-base font-semibold text-slate-950 dark:text-white">{sprint.name}</h3>
          {sprint.goal && <p>{sprint.goal}</p>}
          <p>
            {fmtDate(sprint.startsAt, ctx.locale)}
            {sprint.startsAt && sprint.endsAt ? " – " : ""}
            {fmtDate(sprint.endsAt, ctx.locale)}
          </p>
          <p>
            {summary.taskCount} {ctx.t("مهمة", "tasks")} · {summary.storyPoints} pts
          </p>
          <div className="flex justify-end gap-2 pt-3">
            <Btn variant="ghost" onClick={onClose}>
              {ctx.t("إلغاء", "Cancel")}
            </Btn>
            <Btn variant="primary" disabled={pending} onClick={() => void onConfirm()}>
              {ctx.t("بدء السبرنت", "Start Sprint")}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

type LifecycleDialogProps = {
  sprint: Sprint | null;
  tasks: Task[];
  ctx: ViewCtx;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function CompleteSprintDialog({
  sprint,
  tasks,
  plannedSprints,
  ctx,
  pending,
  onClose,
  onConfirm,
}: Omit<LifecycleDialogProps, "onConfirm"> & {
  plannedSprints: Sprint[];
  onConfirm: (destination: CompleteSprintDestination) => Promise<void>;
}) {
  const [destination, setDestination] = useState("backlog");
  const summary = useMemo(() => sprintSummary(tasks), [tasks]);
  useEffect(() => setDestination("backlog"), [sprint?.id]);
  return (
    <Modal
      open={Boolean(sprint)}
      onClose={onClose}
      title={ctx.t(`إكمال ${sprint?.name ?? ""}`, `Complete ${sprint?.name ?? ""}`)}
    >
      {sprint && (
        <div className="space-y-4 text-sm text-slate-600 dark:text-zinc-300">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center dark:bg-white/4">
            <div>
              <strong className="block text-lg text-slate-950 dark:text-white">{summary.taskCount}</strong>
              {ctx.t("الكل", "Total")}
            </div>
            <div>
              <strong className="block text-lg text-emerald-600">{summary.completedCount}</strong>
              {ctx.t("مكتملة", "Completed")}
            </div>
            <div>
              <strong className="block text-lg text-amber-600">{summary.incompleteCount}</strong>
              {ctx.t("غير مكتملة", "Unfinished")}
            </div>
          </div>
          <p>
            {summary.completedStoryPoints} / {summary.storyPoints} pts {ctx.t("مكتملة", "completed")}
          </p>
          <fieldset disabled={pending} className="space-y-2">
            <legend className="mb-2 font-semibold text-slate-900 dark:text-white">
              {ctx.t("نقل المهام غير المكتملة إلى", "Move unfinished tasks to")}
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="destination"
                checked={destination === "backlog"}
                onChange={() => setDestination("backlog")}
              />
              {ctx.t("التراكم", "Backlog")}
            </label>
            {plannedSprints.map((candidate) => (
              <label key={candidate.id} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="destination"
                  checked={destination === candidate.id}
                  onChange={() => setDestination(candidate.id)}
                />
                {candidate.name}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={onClose}>
              {ctx.t("إلغاء", "Cancel")}
            </Btn>
            <Btn
              variant="primary"
              disabled={pending}
              onClick={() =>
                void onConfirm(
                  destination === "backlog" ? { type: "backlog" } : { type: "sprint", sprintId: destination },
                )
              }
            >
              {pending ? ctx.t("جارٍ الإكمال…", "Completing…") : ctx.t("إكمال السبرنت", "Complete Sprint")}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function CancelSprintDialog({ sprint, tasks, ctx, pending, onClose, onConfirm }: LifecycleDialogProps) {
  return (
    <Modal open={Boolean(sprint)} onClose={onClose} title={ctx.t("إلغاء السبرنت", "Cancel Sprint")}>
      {sprint && (
        <div className="space-y-4 text-sm text-slate-600 dark:text-zinc-300">
          <p>
            {ctx.t(
              `سيُلغى ${sprint.name} وتعود ${tasks.length} مهمة مرتبطة إلى التراكم. سيبقى سجل السبرنت محفوظاً.`,
              `${sprint.name} will be cancelled and ${tasks.length} associated tasks will return to Backlog. Sprint history will remain.`,
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={onClose}>
              {ctx.t("رجوع", "Go back")}
            </Btn>
            <Btn variant="danger" disabled={pending} onClick={() => void onConfirm()}>
              {pending ? ctx.t("جارٍ الإلغاء…", "Cancelling…") : ctx.t("إلغاء السبرنت", "Cancel Sprint")}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
