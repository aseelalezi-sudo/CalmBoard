"use client";
import { useState } from "react";
import type { Goal, ViewCtx } from "@/lib/types";
import { Avatar, Badge, Btn, Card, Empty, Ring } from "@/components/ui";
import { IconPlus, IconTarget } from "@/components/icons";

function goalTone(status: Goal["status"]) {
  return status === "achieved" || status === "on_track"
    ? ("emerald" as const)
    : status === "at_risk"
      ? ("amber" as const)
      : ("rose" as const);
}

function measurementSummary(goal: Goal, t: ViewCtx["t"]) {
  if (goal.progressMode === "tasks") {
    return `${goal.linkedTasks?.length ?? 0} ${t("مهام مرتبطة", "linked tasks")}`;
  }
  if (goal.progressMode === "children") return t("محسوب من النتائج الرئيسية", "Calculated from key results");
  if (goal.progressMode === "manual") return t("تحديث يدوي", "Manual check-in");
  const unit = goal.measurementUnit === "percentage" ? "%" : goal.measurementUnit === "currency" ? " SAR" : "";
  return `${goal.currentValue}${unit} / ${goal.targetValue}${unit}`;
}

export function GoalsView({ ctx }: { ctx: ViewCtx }) {
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [checkinNote, setCheckinNote] = useState("");
  const [checkinProgress, setCheckinProgress] = useState(0);
  const [checkinValue, setCheckinValue] = useState(0);
  const [taskSelections, setTaskSelections] = useState<Record<string, string>>({});
  const [taskWeights, setTaskWeights] = useState<Record<string, number>>({});

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
    return (
      <div
        key={goal.id}
        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.025]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={goalTone(goal.status)}>{goal.status}</Badge>
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {ctx.t("نتيجة رئيسية", "Key result")}
              </span>
            </div>
            <h4 className="mt-2 text-[13.5px] font-semibold text-slate-900 dark:text-white">{goal.title}</h4>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
              {measurementSummary(goal, ctx.t)} • {ctx.t("الوزن", "weight")} {goal.weight}
            </p>
          </div>
          <Ring
            value={goal.progress}
            size={56}
            stroke={6}
            label={<span className="mono text-[11px] font-bold">{goal.progress}%</span>}
          />
        </div>

        {(goal.linkedTasks ?? []).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(goal.linkedTasks ?? []).map((task) => (
              <span
                key={task.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10.5px] text-slate-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <b>{task.serial}</b> {task.title} ({task.progress}%)
                <button
                  disabled={!ctx.can("goals.manage")}
                  onClick={() => ctx.unlinkGoalTask(goal.id, task.id)}
                  className="ms-1 font-bold text-rose-500 disabled:hidden"
                  aria-label={ctx.t("إزالة الارتباط", "Unlink task")}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Btn size="sm" variant="outline" disabled={!ctx.can("goals.manage")} onClick={() => openCheckin(goal)}>
            🎯 {ctx.t("تسجيل تقدم", "Check-in")}
          </Btn>
          {ctx.can("goals.manage") && (
            <>
              <select
                name="auto-field-acsllgh"
                value={taskSelections[goal.id] ?? ""}
                onChange={(event) => setTaskSelections((current) => ({ ...current, [goal.id]: event.target.value }))}
                className="min-w-44 flex-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] text-slate-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
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
                className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-2 text-[11px] text-slate-700 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
              />
              <Btn
                size="sm"
                variant="glow"
                disabled={!taskSelections[goal.id]}
                onClick={() => {
                  ctx.linkGoalTask(goal.id, taskSelections[goal.id]!, taskWeights[goal.id] ?? 1);
                  setTaskSelections((current) => ({ ...current, [goal.id]: "" }));
                }}
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
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">
            {ctx.t("الأهداف والنتائج الرئيسية", "Objectives & Key Results")}
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
            {ctx.t(
              "تقدم موزون من نتائج قابلة للقياس أو مهام فعلية",
              "Weighted progress from measurable results or real tasks",
            )}
          </p>
        </div>
        <Btn variant="glow" disabled={!ctx.can("goals.manage")} onClick={() => ctx.setShowNewGoal(true)}>
          <IconPlus size={15} />
          {ctx.t("Objective أو KR جديد", "New Objective or KR")}
        </Btn>
      </div>

      <div className="stagger space-y-4">
        {objectives.map((objective) => {
          const keyResults = ctx.goals.filter((goal) => goal.type === "key_result" && goal.parentId === objective.id);
          return (
            <Card
              key={objective.id}
              className="p-5 bg-white dark:bg-white/[0.02]"
              glow={objective.status === "on_track"}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
                    <IconTarget size={18} />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={goalTone(objective.status)}>{objective.status}</Badge>
                      <span className="text-[10px] font-bold uppercase text-slate-400">Objective</span>
                    </div>
                    <h3 className="mt-2 text-[15px] font-bold text-slate-900 dark:text-white">{objective.title}</h3>
                    {objective.owner && (
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
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
                    label={<span className="mono text-[13px] font-bold">{objective.progress}%</span>}
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    {keyResults.length} {ctx.t("نتائج رئيسية", "key results")}
                  </p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {keyResults.map(keyResultCard)}
                {keyResults.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-200 py-5 text-center text-[12px] text-slate-400 dark:border-white/10">
                    {ctx.t("أضف نتيجة رئيسية لاحتساب تقدم هذا الهدف.", "Add a key result to calculate this objective.")}
                  </p>
                )}
              </div>
            </Card>
          );
        })}
        {orphanKeyResults.length > 0 && (
          <Card className="p-5 border-amber-200 dark:border-amber-500/20">
            <h3 className="mb-3 text-[13px] font-bold text-amber-700 dark:text-amber-300">
              {ctx.t("نتائج قديمة غير مرتبطة بهدف", "Legacy key results without an objective")}
            </h3>
            <div className="space-y-3">{orphanKeyResults.map(keyResultCard)}</div>
          </Card>
        )}
      </div>

      {ctx.goals.length === 0 && (
        <Card>
          <Empty
            icon={<IconTarget size={22} />}
            title={ctx.t("لا توجد OKRs بعد", "No OKRs yet")}
            action={
              <Btn variant="glow" disabled={!ctx.can("goals.manage")} onClick={() => ctx.setShowNewGoal(true)}>
                <IconPlus size={14} />
                {ctx.t("إنشاء أول Objective", "Create first Objective")}
              </Btn>
            }
          />
        </Card>
      )}

      {selectedGoal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            aria-label={ctx.t("إغلاق", "Close")}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md dark:bg-zinc-950/70"
            onClick={() => setSelectedGoal(null)}
          />
          <div className="relative w-full max-w-[500px] rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
            <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">
              🎯 {ctx.t("تسجيل تقدم النتيجة الرئيسية", "Key result check-in")}
            </h3>
            <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">{selectedGoal.title}</p>

            <div className="mt-5 space-y-4">
              {selectedGoal.progressMode === "measurement" && (
                <label className="block space-y-1.5 text-[12px] font-semibold text-slate-700 dark:text-zinc-300">
                  <span>{ctx.t("القيمة الحالية", "Current value")}</span>
                  <input
                    name="auto-field-gsa3xh5"
                    type="number"
                    step="any"
                    value={checkinValue}
                    onChange={(event) => setCheckinValue(Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white p-3 text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                  />
                </label>
              )}
              {selectedGoal.progressMode === "manual" && (
                <div>
                  <div className="mb-1 flex justify-between text-[12px] font-semibold text-slate-700 dark:text-zinc-300">
                    <span>{ctx.t("نسبة الإنجاز", "Progress")}</span>
                    <span>{checkinProgress}%</span>
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
                <p className="rounded-xl bg-indigo-50 p-3 text-[12px] text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
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
                className="min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-[13px] text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
              />

              {(selectedGoal.checkins ?? []).length > 0 && (
                <div className="max-h-40 space-y-2 overflow-y-auto border-t border-slate-100 pt-4 dark:border-white/10">
                  {(selectedGoal.checkins ?? []).map((checkin) => (
                    <div key={checkin.id} className="rounded-xl bg-slate-50 p-2.5 text-[11px] dark:bg-white/[0.03]">
                      <div className="flex justify-between font-semibold text-slate-700 dark:text-zinc-200">
                        <span>
                          {checkin.author || ctx.t("عضو", "Member")} • {checkin.progress}%
                        </span>
                        <span className="text-slate-400">
                          {new Date(checkin.date).toLocaleDateString(ctx.locale === "ar" ? "ar-EG" : "en-US")}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500 dark:text-zinc-400">{checkin.note}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Btn
                  variant="glow"
                  size="lg"
                  className="flex-1"
                  disabled={!checkinNote.trim()}
                  onClick={() => {
                    ctx.addGoalCheckin(selectedGoal.id, {
                      note: checkinNote.trim(),
                      ...(selectedGoal.progressMode === "manual" ? { progress: checkinProgress } : {}),
                      ...(selectedGoal.progressMode === "measurement" ? { currentValue: checkinValue } : {}),
                    });
                    setSelectedGoal(null);
                  }}
                >
                  {ctx.t("حفظ التحديث", "Save check-in")}
                </Btn>
                <Btn variant="outline" size="lg" onClick={() => setSelectedGoal(null)}>
                  {ctx.t("إلغاء", "Cancel")}
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
