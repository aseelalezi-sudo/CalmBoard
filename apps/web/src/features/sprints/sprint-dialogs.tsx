"use client";

import { useEffect, useMemo, useState } from "react";
import type { Sprint, Task, ViewCtx } from "@/lib/types";
import { fmtDate, fmtNumber } from "@/lib/types";
import { Btn, Modal, inputCls, areaCls } from "@/components/ui";
import type { CompleteSprintDestination, SprintFormInput } from "./api";
import { sprintSummary, validateSprintForm } from "./sprint-domain";

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
      onClose={pending ? () => undefined : onClose}
      title={sprint ? ctx.t("تعديل السبرنت", "Edit Sprint") : ctx.t("إنشاء سبرنت", "Create Sprint")}
    >
      <div className="space-y-4">
        <label className="block text-sm font-medium text-ink">
          {ctx.t("اسم السبرنت", "Sprint name")}
          <input
            autoFocus
            disabled={pending}
            aria-invalid={Boolean(error && !name.trim())}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`${inputCls} mt-1.5`}
          />
        </label>
        <label className="block text-sm font-medium text-ink">
          {ctx.t("الهدف", "Goal")}
          <textarea
            disabled={pending}
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={3}
            className={`${areaCls} mt-1.5 resize-none`}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-ink">
            {ctx.t("البداية المخططة", "Planned start")}
            <input
              type="date"
              disabled={pending}
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className={`${inputCls} mt-1.5`}
            />
          </label>
          <label className="text-sm font-medium text-ink">
            {ctx.t("النهاية المخططة", "Planned end")}
            <input
              type="date"
              disabled={pending}
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
              className={`${inputCls} mt-1.5`}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}
        <div className="flex min-h-10 items-center justify-end gap-2 border-t border-line pt-4">
          <Btn variant="outline" disabled={pending} onClick={onClose}>
            {ctx.t("إلغاء", "Cancel")}
          </Btn>
          <Btn variant="glow" disabled={pending} onClick={() => void submit()}>
            {pending ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("حفظ", "Save")}
          </Btn>
        </div>
      </div>
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

export function StartSprintDialog({ sprint, tasks, ctx, pending, onClose, onConfirm }: LifecycleDialogProps) {
  const summary = sprintSummary(tasks);
  return (
    <Modal
      open={Boolean(sprint)}
      onClose={pending ? () => undefined : onClose}
      title={ctx.t("بدء السبرنت", "Start Sprint")}
    >
      {sprint && (
        <div className="space-y-3 text-sm text-ink-soft">
          <h3 className="text-base font-semibold text-ink">{sprint.name}</h3>
          {sprint.goal && <p>{sprint.goal}</p>}
          <p>
            {fmtDate(sprint.startsAt, ctx.locale)}
            {sprint.startsAt && sprint.endsAt ? " – " : ""}
            {fmtDate(sprint.endsAt, ctx.locale)}
          </p>
          <p>
            {fmtNumber(summary.taskCount, ctx.locale)} {ctx.t("مهمة", "tasks")} ·{" "}
            {fmtNumber(summary.storyPoints, ctx.locale)} pts
          </p>
          <div className="flex min-h-10 items-center justify-end gap-2 pt-3">
            <Btn variant="outline" disabled={pending} onClick={onClose}>
              {ctx.t("إلغاء", "Cancel")}
            </Btn>
            <Btn variant="glow" disabled={pending} onClick={() => void onConfirm()}>
              {pending ? ctx.t("جارٍ البدء…", "Starting…") : ctx.t("بدء السبرنت", "Start Sprint")}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

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
      onClose={pending ? () => undefined : onClose}
      title={ctx.t(`إكمال ${sprint?.name ?? ""}`, `Complete ${sprint?.name ?? ""}`)}
    >
      {sprint && (
        <div className="space-y-4 text-sm text-ink-soft">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-raised p-3 text-center border border-line">
            <div>
              <strong className="block text-lg text-ink">{fmtNumber(summary.taskCount, ctx.locale)}</strong>
              {ctx.t("الكل", "Total")}
            </div>
            <div>
              <strong className="block text-lg text-emerald-600 dark:text-emerald-400">
                {fmtNumber(summary.completedCount, ctx.locale)}
              </strong>
              {ctx.t("مكتملة", "Completed")}
            </div>
            <div>
              <strong className="block text-lg text-amber-600 dark:text-amber-400">
                {fmtNumber(summary.incompleteCount, ctx.locale)}
              </strong>
              {ctx.t("غير مكتملة", "Unfinished")}
            </div>
          </div>
          <p>
            {fmtNumber(summary.completedStoryPoints, ctx.locale)} / {fmtNumber(summary.storyPoints, ctx.locale)} pts{" "}
            {ctx.t("مكتملة", "completed")}
          </p>
          <fieldset disabled={pending} className="space-y-2">
            <legend className="mb-2 font-semibold text-ink">
              {ctx.t("نقل المهام غير المكتملة إلى", "Move unfinished tasks to")}
            </legend>
            <label className="flex min-h-10 items-center gap-2">
              <input
                type="radio"
                name="destination"
                checked={destination === "backlog"}
                disabled={pending}
                onChange={() => setDestination("backlog")}
              />
              {ctx.t("التراكم", "Backlog")}
            </label>
            {plannedSprints.map((candidate) => (
              <label key={candidate.id} className="flex min-h-10 items-center gap-2">
                <input
                  type="radio"
                  name="destination"
                  checked={destination === candidate.id}
                  disabled={pending}
                  onChange={() => setDestination(candidate.id)}
                />
                {candidate.name}
              </label>
            ))}
          </fieldset>
          <div className="flex min-h-10 items-center justify-end gap-2">
            <Btn variant="outline" disabled={pending} onClick={onClose}>
              {ctx.t("إلغاء", "Cancel")}
            </Btn>
            <Btn
              variant="glow"
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
    <Modal
      open={Boolean(sprint)}
      onClose={pending ? () => undefined : onClose}
      title={ctx.t("إلغاء السبرنت", "Cancel Sprint")}
    >
      {sprint && (
        <div className="space-y-4 text-sm text-ink-soft">
          <p>
            {ctx.t(
              `سيُلغى ${sprint.name} وتعود ${fmtNumber(tasks.length, ctx.locale)} مهمة مرتبطة إلى التراكم. سيبقى سجل السبرنت محفوظاً.`,
              `${sprint.name} will be cancelled and ${tasks.length} associated tasks will return to Backlog. Sprint history will remain.`,
            )}
          </p>
          <div className="flex min-h-10 items-center justify-end gap-2">
            <Btn variant="outline" disabled={pending} onClick={onClose}>
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
