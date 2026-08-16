"use client";

import { useState } from "react";
import type { Goal, ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { Avatar, Badge, Btn, Card, Modal, Ring, ScreenHeader, ScreenState } from "@/components/ui";
import { IconPlus, IconTarget } from "@/components/icons";

function goalTone(status: Goal["status"]) {
  return status === "achieved" || status === "on_track"
    ? ("emerald" as const)
    : status === "at_risk"
      ? ("amber" as const)
      : ("rose" as const);
}

function measurementSummary(goal: Goal, ctx: ViewCtx) {
  if (goal.progressMode === "tasks") {
    return `${fmtNumber(goal.linkedTasks?.length ?? 0, ctx.locale)} ${ctx.t("مهام مرتبطة", "linked tasks")}`;
  }
  if (goal.progressMode === "children") return ctx.t("محسوب من النتائج الرئيسية", "Calculated from key results");
  if (goal.progressMode === "manual") return ctx.t("تحديث يدوي", "Manual check-in");
  if (goal.measurementUnit === "currency") {
    const currencyFmt = new Intl.NumberFormat(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US", {
      style: "currency",
      currency: "SAR",
    });
    return `${currencyFmt.format(goal.currentValue)} / ${currencyFmt.format(goal.targetValue)}`;
  }
  const unit = goal.measurementUnit === "percentage" ? "%" : "";
  return `${fmtNumber(goal.currentValue, ctx.locale)}${unit} / ${fmtNumber(goal.targetValue, ctx.locale)}${unit}`;
}

export function GoalsView({ ctx }: { ctx: ViewCtx }) {
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [checkinNote, setCheckinNote] = useState("");
  const [checkinProgress, setCheckinProgress] = useState(0);
  const [checkinValue, setCheckinValue] = useState(0);
  const [taskSelections, setTaskSelections] = useState<Record<string, string>>({});
  const [taskWeights, setTaskWeights] = useState<Record<string, number>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const canManageGoals = ctx.can("goals.manage");

  const runMutation = async (
    actionKey: string,
    operation: () => Promise<unknown> | unknown,
    onSuccess?: () => void,
  ) => {
    setPendingAction(actionKey);
    try {
      await operation();
      onSuccess?.();
    } catch {
      // notification handled by operation
    } finally {
      setPendingAction(null);
    }
  };

  const objectives = ctx.goals.filter((goal) => goal.type === "objective");
  const orphanKeyResults = ctx.goals.filter(
    (goal) => goal.type === "key_result" && !objectives.some((objective) => objective.id === goal.parentId),
  );

  const openCheckin = (goal: Goal) => {
    setSelectedGoal(goal);
    setCheckinProgress(goal.progress);
    setCheckinValue(goal.currentValue);
    setCheckinNote("");
  };

  const keyResultCard = (goal: Goal) => {
    const linkedTaskIds = new Set((goal.linkedTasks ?? []).map((task) => task.id));
    const availableTasks = ctx.tasks.filter((task) => !linkedTaskIds.has(task.id));
    const invalidWeight =
      !Number.isFinite(taskWeights[goal.id] ?? 1) ||
      (taskWeights[goal.id] ?? 1) < 0.1 ||
      (taskWeights[goal.id] ?? 1) > 100;

    return (
      <div key={goal.id} className="rounded-2xl border border-line bg-raised/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={goalTone(goal.status)}>{goal.status}</Badge>
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                {ctx.t("نتيجة رئيسية", "Key result")}
              </span>
            </div>
            <h4 className="mt-2 text-[13.5px] font-semibold text-ink">{goal.title}</h4>
            <p className="mt-1 text-[11px] text-ink-soft">
              {measurementSummary(goal, ctx)} • {ctx.t("الوزن", "weight")} {fmtNumber(goal.weight, ctx.locale)}
            </p>
          </div>
          <Ring
            value={goal.progress}
            size={56}
            stroke={6}
            label={<span className="mono text-[11px] font-bold">{fmtNumber(goal.progress, ctx.locale)}%</span>}
          />
        </div>

        {(goal.linkedTasks ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(goal.linkedTasks ?? []).map((task) => (
              <span
                key={task.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-[10.5px] text-ink"
              >
                <b>{task.serial}</b> {task.title} ({fmtNumber(task.progress, ctx.locale)}%)
                {canManageGoals && (
                  <button
                    disabled={pendingAction === `${goal.id}:${task.id}:unlink`}
                    aria-busy={pendingAction === `${goal.id}:${task.id}:unlink`}
                    onClick={() =>
                      runMutation(`${goal.id}:${task.id}:unlink`, () => ctx.unlinkGoalTask(goal.id, task.id))
                    }
                    className="ms-1 font-bold text-rose-500 hover:text-rose-600 disabled:opacity-50"
                    aria-label={ctx.t("إزالة الارتباط", "Unlink task")}
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canManageGoals && (
            <Btn size="sm" variant="outline" onClick={() => openCheckin(goal)}>
              <IconTarget size={13} />
              {ctx.t("تسجيل تقدم", "Check-in")}
            </Btn>
          )}
          {canManageGoals && (
            <>
              <select
                name="auto-field-acsllgh"
                value={taskSelections[goal.id] ?? ""}
                onChange={(event) => setTaskSelections((current) => ({ ...current, [goal.id]: event.target.value }))}
                className="h-8.5 min-w-44 flex-1 rounded-xl border border-line bg-surface px-2.5 text-[11.5px] font-medium text-ink shadow-xs outline-none transition focus:border-accent"
              >
                <option value="">{ctx.t("ربط مهمة…", "Link a task…")}</option>
                {availableTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.serial} — {task.title}
                  </option>
                ))}
              </select>
              <input
                name="auto-field-t6w8d3j"
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={taskWeights[goal.id] ?? 1}
                onChange={(event) =>
                  setTaskWeights((current) => ({ ...current, [goal.id]: Number(event.target.value) }))
                }
                title={ctx.t("وزن مساهمة المهمة", "Task contribution weight")}
                className="w-16 rounded-xl border border-line bg-surface px-2 py-2 text-[11px] text-ink outline-none focus:border-indigo-500"
              />
              <Btn
                size="sm"
                variant="glow"
                disabled={!taskSelections[goal.id] || invalidWeight || pendingAction === `${goal.id}:link`}
                aria-busy={pendingAction === `${goal.id}:link`}
                onClick={() =>
                  runMutation(
                    `${goal.id}:link`,
                    () => ctx.linkGoalTask(goal.id, taskSelections[goal.id]!, taskWeights[goal.id] ?? 1),
                    () => setTaskSelections((current) => ({ ...current, [goal.id]: "" })),
                  )
                }
              >
                {ctx.t("ربط", "Link")}
              </Btn>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="screen-container-wide space-y-5">
      <ScreenHeader
        title={ctx.t("الأهداف والنتائج الرئيسية", "Objectives & Key Results")}
        description={ctx.t(
          "تقدم موزون من نتائج قابلة للقياس أو مهام فعلية",
          "Weighted progress from measurable results or real tasks",
        )}
        actions={
          canManageGoals ? (
            <Btn variant="glow" onClick={() => ctx.setShowNewGoal(true)}>
              <IconPlus size={15} />
              {ctx.t("Objective أو KR جديد", "New Objective or KR")}
            </Btn>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {objectives.map((objective) => {
          const keyResults = ctx.goals.filter((goal) => goal.type === "key_result" && goal.parentId === objective.id);
          return (
            <Card key={objective.id} className="bg-surface p-5" glow={objective.status === "on_track"}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-indigo-500 to-violet-500 text-white">
                    <IconTarget size={18} />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={goalTone(objective.status)}>{objective.status}</Badge>
                      <span className="text-[10px] font-bold uppercase text-ink-faint">Objective</span>
                    </div>
                    <h3 className="mt-2 text-[15px] font-bold text-ink">{objective.title}</h3>
                    {objective.owner && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-soft">
                        <Avatar src={objective.owner.avatarUrl} name={objective.owner.name} size={16} />
                        {objective.owner.name}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-center">
                  <Ring
                    value={objective.progress}
                    size={72}
                    stroke={7}
                    label={
                      <span className="mono text-[13px] font-bold">{fmtNumber(objective.progress, ctx.locale)}%</span>
                    }
                  />
                  <p className="mt-1 text-[10px] text-ink-faint">
                    {fmtNumber(keyResults.length, ctx.locale)} {ctx.t("نتائج رئيسية", "key results")}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {keyResults.map(keyResultCard)}
                {keyResults.length === 0 && (
                  <p className="rounded-xl border border-dashed border-line py-5 text-center text-[12px] text-ink-faint">
                    {ctx.t("أضف نتيجة رئيسية لاحتساب تقدم هذا الهدف.", "Add a key result to calculate this objective.")}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
        {orphanKeyResults.length > 0 && (
          <Card className="border-amber-500/30 bg-surface p-5">
            <h3 className="mb-3 text-[13px] font-bold text-amber-600 dark:text-amber-400">
              {ctx.t("نتائج قديمة غير مرتبطة بهدف", "Legacy key results without an objective")}
            </h3>
            <div className="space-y-3">{orphanKeyResults.map(keyResultCard)}</div>
          </Card>
        )}
      </div>

      {ctx.goals.length === 0 && (
        <Card className="bg-surface">
          <ScreenState
            framed={false}
            tone="empty"
            title={ctx.t("لا توجد OKRs بعد", "No OKRs yet")}
            description={ctx.t(
              "ابدأ بإضافة الأهداف والنتائج الرئيسية لقياس أداء الفريق",
              "Start adding objectives and key results to track team progress",
            )}
            action={
              canManageGoals ? (
                <Btn variant="glow" onClick={() => ctx.setShowNewGoal(true)}>
                  <IconPlus size={14} />
                  {ctx.t("إنشاء أول Objective", "Create first Objective")}
                </Btn>
              ) : undefined
            }
          />
        </Card>
      )}

      {selectedGoal && (
        <Modal
          open={Boolean(selectedGoal)}
          onClose={() => setSelectedGoal(null)}
          title={ctx.t("تسجيل تقدم النتيجة الرئيسية", "Key result check-in")}
          description={selectedGoal.title}
        >
          <div className="space-y-4">
            {selectedGoal.progressMode === "measurement" && (
              <label className="block space-y-1.5 text-[12px] font-semibold text-ink">
                <span>{ctx.t("القيمة الحالية", "Current value")}</span>
                <input
                  name="auto-field-gsa3xh5"
                  type="number"
                  step="any"
                  value={checkinValue}
                  onChange={(event) => setCheckinValue(Number(event.target.value))}
                  className="w-full rounded-xl border border-line bg-surface p-3 text-ink outline-none focus:border-indigo-500"
                />
              </label>
            )}
            {selectedGoal.progressMode === "manual" && (
              <div>
                <div className="mb-1 flex justify-between text-[12px] font-semibold text-ink">
                  <span>{ctx.t("نسبة الإنجاز", "Progress")}</span>
                  <span>{fmtNumber(checkinProgress, ctx.locale)}%</span>
                </div>
                <input
                  name="auto-field-zuihjsp"
                  type="range"
                  min={0}
                  max={100}
                  value={checkinProgress}
                  onChange={(event) => setCheckinProgress(Number(event.target.value))}
                  className="w-full"
                />
              </div>
            )}
            {(selectedGoal.progressMode === "tasks" || selectedGoal.progressMode === "children") && (
              <p className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-3 text-[12px] text-indigo-700 dark:text-indigo-300">
                {ctx.t(
                  "التقدم محسوب تلقائياً؛ سيُحفظ هذا التحديث كملاحظة بالحالة الحالية.",
                  "Progress is calculated automatically; this check-in records the current state.",
                )}
              </p>
            )}
            <textarea
              name="auto-field-69txz6p"
              value={checkinNote}
              onChange={(event) => setCheckinNote(event.target.value)}
              placeholder={ctx.t("ملاحظات التقدم والمخاطر…", "Progress and risk notes…")}
              className="min-h-24 w-full resize-none rounded-xl border border-line bg-surface p-3 text-[13px] text-ink outline-none focus:border-indigo-500"
            />

            {(selectedGoal.checkins ?? []).length > 0 && (
              <div className="max-h-40 space-y-2 overflow-y-auto border-t border-line pt-4">
                {(selectedGoal.checkins ?? []).map((checkin) => (
                  <div key={checkin.id} className="rounded-xl border border-line bg-raised p-2.5 text-[11px]">
                    <div className="flex justify-between font-semibold text-ink">
                      <span>
                        {checkin.author || ctx.t("عضو", "Member")} • {fmtNumber(checkin.progress, ctx.locale)}%
                      </span>
                      <time dateTime={new Date(checkin.date).toISOString()} className="text-ink-faint">
                        {new Date(checkin.date).toLocaleDateString(ctx.locale === "ar" ? "ar-u-nu-latn" : "en-US")}
                      </time>
                    </div>
                    <p className="mt-1 text-ink-soft">{checkin.note}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Btn
                variant="glow"
                size="lg"
                className="flex-1"
                disabled={!checkinNote.trim() || pendingAction === `${selectedGoal.id}:checkin`}
                aria-busy={pendingAction === `${selectedGoal.id}:checkin`}
                onClick={() =>
                  runMutation(
                    `${selectedGoal.id}:checkin`,
                    () =>
                      ctx.addGoalCheckin(selectedGoal.id, {
                        note: checkinNote.trim(),
                        ...(selectedGoal.progressMode === "manual" ? { progress: checkinProgress } : {}),
                        ...(selectedGoal.progressMode === "measurement" ? { currentValue: checkinValue } : {}),
                      }),
                    () => setSelectedGoal(null),
                  )
                }
              >
                {ctx.t("حفظ التحديث", "Save check-in")}
              </Btn>
              <Btn variant="outline" size="lg" onClick={() => setSelectedGoal(null)}>
                {ctx.t("إلغاء", "Cancel")}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
