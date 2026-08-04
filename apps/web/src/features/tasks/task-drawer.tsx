"use client";
import { useState, type CSSProperties } from "react";
import type { Comment, Task, ViewCtx, Workspace } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";
import { areaCls, Avatar, Badge, Bar, Btn, Field, inputCls, selectCls } from "@/components/ui";
import {
  IconAt,
  IconCheck,
  IconClock,
  IconComment,
  IconDoc,
  IconPaperclip,
  IconPlus,
  IconSend,
  IconShield,
  IconSparkle,
  IconSubtask,
  IconX,
} from "@/components/icons";

/* ================= Task Drawer ================= */
export function TaskDrawer({
  ctx,
  task,
  onClose,
  comments,
  subtasks,
  addSubtask,
  toggleSubtask,
  addComment,
  editComment,
  logTime,
}: {
  ctx: ViewCtx;
  task: Task | null;
  onClose: () => void;
  comments: Comment[];
  subtasks: Task[];
  addSubtask: (t: string) => void;
  toggleSubtask: (s: Task) => void;
  addComment: (c: string) => void;
  editComment: (id: string, content: string) => void;
  logTime: (id: string, m: number, d: string) => void;
}) {
  const [comment, setComment] = useState("");
  if (!task) return null;
  const st = STATUS_CONFIG[task.status];
  const pr = PRIORITY_CONFIG[task.priority];
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm dark:bg-zinc-950/60 animate-fade"
        onClick={onClose}
      />
      <div
        className="theme-adaptive-panel animate-slide relative flex w-full max-w-[580px] flex-col border-s border-slate-200 bg-white/98 text-slate-900 shadow-2xl dark:border-white/[0.08] dark:bg-[#0d0d15]/98 dark:text-zinc-100"
        style={{ "--slide-x": "-32px" } as CSSProperties}
      >
        <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-5">
          <span className="mono rounded-lg border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-zinc-400">
            {task.serial}
          </span>
          <Badge tone={st?.tone}>{st?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
          <Badge tone={pr?.tone}>{pr?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-white"
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <input
              name="auto-field-d5nhmo7"
              value={task.title}
              onChange={(e) => ctx.updateTask(task.id, { title: e.target.value })}
              className="w-full bg-transparent text-[19px] font-bold leading-tight text-white outline-none"
            />

            <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4">
              <Field label={ctx.t("المسؤول", "Assignee")}>
                <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 h-10">
                  <Avatar
                    src={task.assignee?.avatarUrl || ctx.users.find((u) => u.id === task.assigneeId)?.avatarUrl}
                    name={task.assignee?.name}
                    size={22}
                  />
                  <select
                    name="auto-field-g5c5r17"
                    value={task.assigneeId || ""}
                    onChange={(e) => ctx.updateTask(task.id, { assigneeId: e.target.value || undefined })}
                    className="flex-1 bg-transparent text-[12.5px] text-white outline-none [&>option]:bg-zinc-900"
                  >
                    <option value="">{ctx.t("غير معيّن", "Unassigned")}</option>
                    {ctx.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
              <div className="col-span-2">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-300/50 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 p-2.5 text-[11.5px] dark:border-violet-500/30">
                  <div className="flex items-center gap-2 text-indigo-300">
                    <span className="text-[14px]">🤖</span>
                    <span>{ctx.t("المسؤول الأمثل بناءً على المهارات والعبء:", "Best assignee by skills & load:")}</span>
                  </div>
                  <button
                    onClick={() => {
                      const bestUser =
                        ctx.users.find((u) =>
                          (u.skills || []).some(
                            (s) =>
                              task.title.toLowerCase().includes(s.toLowerCase()) ||
                              (task.description || "").toLowerCase().includes(s.toLowerCase()),
                          ),
                        ) || ctx.users[0];
                      if (bestUser) {
                        ctx.updateTask(task.id, { assigneeId: bestUser.id });
                        ctx.notify(
                          `🤖 ${ctx.t("تم اقتراح وتعيين", "AI assigned to")} ${bestUser.name} (${(bestUser.skills || []).slice(0, 2).join(", ")}) ✓`,
                        );
                      }
                    }}
                    className="rounded-lg bg-indigo-600 px-2.5 py-1 font-bold text-white shadow-sm hover:bg-indigo-500 transition"
                  >
                    ✨ {ctx.t("تعيين تلقائي (AI Match)", "AI Match Assignee")}
                  </button>
                </div>
              </div>
              <Field label={ctx.t("الاستحقاق", "Due date")}>
                <input
                  name="auto-field-qjf1fey"
                  type="date"
                  defaultValue={task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : ""}
                  onChange={(e) =>
                    ctx.updateTask(task.id, {
                      dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                      ...(task.isMilestone
                        ? { startDate: e.target.value ? new Date(e.target.value).toISOString() : undefined }
                        : {}),
                    })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label={ctx.t("علامة فارقة", "Milestone")}>
                <button
                  disabled={!task.dueDate && !task.isMilestone}
                  onClick={() => {
                    if (task.isMilestone) {
                      ctx.updateTask(task.id, { isMilestone: false });
                      return;
                    }
                    if (!task.dueDate) return;
                    ctx.updateTask(task.id, {
                      isMilestone: true,
                      startDate: task.dueDate,
                      dueDate: task.dueDate,
                    });
                  }}
                  className={`flex h-10 w-full items-center justify-between rounded-xl border px-3 text-[12px] font-semibold disabled:opacity-40 ${task.isMilestone ? "border-amber-500/40 bg-amber-500/15 text-amber-300" : "border-white/[0.08] bg-white/[0.03] text-zinc-400"}`}
                >
                  <span>
                    {task.isMilestone ? ctx.t("علامة فارقة", "Milestone") : ctx.t("مهمة عادية", "Regular task")}
                  </span>
                  <span className={task.isMilestone ? "rotate-45 text-amber-400" : "text-zinc-600"}>◆</span>
                </button>
              </Field>
              <Field label={ctx.t("الحالة", "Status")}>
                <select
                  name="auto-field-pqwbctu"
                  value={task.status}
                  onChange={(e) => ctx.updateTask(task.id, { status: e.target.value })}
                  className={selectCls}
                >
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {ctx.t(v.ar, v.en)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={ctx.t("الأولوية", "Priority")}>
                <select
                  name="auto-field-n6s0sz3"
                  value={task.priority}
                  onChange={(e) => ctx.updateTask(task.id, { priority: e.target.value })}
                  className={selectCls}
                >
                  {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {ctx.t(v.ar, v.en)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={ctx.t("الوقت", "Time")}>
                <div className="flex h-10 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3">
                  <span className="mono text-[12px] text-zinc-400 tabular">
                    {task.estimatedHours}h / {(task.loggedHours ?? 0).toFixed(1)}h
                  </span>
                  <button
                    onClick={() => {
                      const v = prompt(ctx.t("عدد الدقائق", "Minutes"));
                      const m = Number(v);
                      if (m > 0) logTime(task.id, m, task.title);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-violet-500/10 border border-violet-500/25 px-2 py-1 text-[10.5px] font-semibold text-violet-700 dark:text-violet-300"
                  >
                    <IconClock size={11} />
                    {ctx.t("تسجيل", "Log")}
                  </button>
                </div>
              </Field>
              <Field label={ctx.t("النقاط", "Points")}>
                <div className="flex h-10 items-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3">
                  <span className="mono text-[12px] text-amber-300 tabular">{task.storyPoints ?? "—"} pts</span>
                </div>
              </Field>
              <Field label={ctx.t("التكرار", "Recurrence")}>
                <div className="flex h-10 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.03] px-3">
                  <span className="text-[12px] text-zinc-300">
                    {task.isRecurring ? ctx.t("متكرر أسبوعياً", "Weekly recurring") : ctx.t("لتمت تكرار", "One-off")}
                  </span>
                  <button
                    onClick={() => ctx.updateTask(task.id, { isRecurring: !task.isRecurring })}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border ${task.isRecurring ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-300" : "bg-white/[0.05] border-white/10 text-zinc-500"}`}
                  >
                    {task.isRecurring ? "✓" : "+"}
                  </button>
                </div>
              </Field>
              <Field label={ctx.t("سبب التأخير", "Delay Reason")}>
                <input
                  name="auto-field-g5z8jgo"
                  defaultValue={task.delayReason || ""}
                  onBlur={(e) => ctx.updateTask(task.id, { delayReason: e.target.value })}
                  placeholder={ctx.t("اختياري: بانتظار العميل...", "Optional: waiting on client...")}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-300 font-bold text-[12.5px]">
                  <span>⏰</span>
                  <span>
                    {ctx.t(
                      "تذكيرات المهمة والمتابعة المخصصة (Reminders & Follow-ups — القسم 9 & 13)",
                      "Task Reminders & Follow-ups",
                    )}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {[
                    ["1h", "بعد ساعة", "In 1 hour"],
                    ["tomorrow", "غداً صباحاً", "Tomorrow morning"],
                    ["2h_before", "قبل الاستحقاق", "2h before due"],
                  ].map(([val, ar, en]) => (
                    <button
                      key={val}
                      onClick={() => {
                        const rems = [
                          ...(task.reminders || []),
                          { id: `rem_${Date.now()}`, time: val, label: ctx.t(ar, en), sent: false },
                        ];
                        ctx.updateTask(task.id, { reminders: rems });
                        ctx.notify(`⏰ ${ctx.t("تم جدولة إشعار تذكير:", "Reminder set:")} ${ctx.t(ar, en)} ✓`);
                      }}
                      className="rounded-lg bg-amber-500/20 border border-amber-500/40 px-2 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-500/30 transition shadow-sm"
                    >
                      + {ctx.t(ar, en)}
                    </button>
                  ))}
                </div>
              </div>
              {(task.reminders || []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-amber-500/20">
                  {(task.reminders || []).map((rem: any, idx: number) => (
                    <span
                      key={rem.id || idx}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-black/40 border border-amber-500/30 px-2.5 py-1 text-[11px] font-semibold text-amber-300"
                    >
                      <span>🔔 {rem.label}</span>
                      <button
                        onClick={() => {
                          const rems = (task.reminders || []).filter((_: any, i: number) => i !== idx);
                          ctx.updateTask(task.id, { reminders: rems });
                        }}
                        className="hover:text-white font-bold"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {ctx.customFields && ctx.customFields.length > 0 && (
              <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="mb-3 text-[11.5px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                  <IconSparkle size={13} />
                  {ctx.t("الحقول المخصصة لمساحة العمل", "Workspace Custom Fields")}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {ctx.customFields.map((cf) => {
                    const val = (task.customFields || {})[cf.key] || "";
                    return (
                      <Field key={cf.id} label={cf.name}>
                        {cf.type === "single_select" || cf.type === "select" ? (
                          <select
                            name="auto-field-xmd61iv"
                            value={val}
                            onChange={(e) =>
                              ctx.updateTask(task.id, {
                                customFields: { ...(task.customFields || {}), [cf.key]: e.target.value },
                              })
                            }
                            className={selectCls}
                          >
                            <option value="">{ctx.t("اختر...", "Select...")}</option>
                            {(cf.options || []).map((o) => (
                              <option key={o.value || o.label} value={o.value || o.label}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : cf.type === "date" ? (
                          <input
                            name="auto-field-7nsk28y"
                            type="date"
                            value={val}
                            onChange={(e) =>
                              ctx.updateTask(task.id, {
                                customFields: { ...(task.customFields || {}), [cf.key]: e.target.value },
                              })
                            }
                            className={inputCls}
                          />
                        ) : (
                          <input
                            name="auto-field-8vsbu1t"
                            value={val}
                            onChange={(e) =>
                              ctx.updateTask(task.id, {
                                customFields: { ...(task.customFields || {}), [cf.key]: e.target.value },
                              })
                            }
                            placeholder={cf.description || cf.key}
                            className={inputCls}
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-7">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-zinc-400">
                  {ctx.t("التبعيات والعلاقات (يسبق / يعتمد على)", "Dependencies & Blocking")}
                </span>
                {(task.dependencies || []).length > 0 && (
                  <span className="mono rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                    {(task.dependencies || []).length} {ctx.t("مرتبط", "linked")}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <select id={`dep-${task.id}`} className={cn(selectCls, "flex-1 text-[12px]")}>
                  <option value="">
                    {ctx.t("+ إضافة مهمة يعتمد عليها هذا العمل...", "+ Add blocking dependency task...")}
                  </option>
                  {ctx.tasks
                    .filter((t) => t.id !== task.id && !(task.dependencies || []).includes(t.serial))
                    .map((t) => (
                      <option key={t.id} value={t.serial}>
                        {t.serial} — {t.title.slice(0, 45)} ({t.status})
                      </option>
                    ))}
                </select>
                <Btn
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const el = document.getElementById(`dep-${task.id}`) as HTMLSelectElement;
                    if (el && el.value) {
                      ctx.updateTask(task.id, { dependencies: [...(task.dependencies || []), el.value] });
                      el.value = "";
                    }
                  }}
                >
                  {ctx.t("ربط", "Link")}
                </Btn>
              </div>
              {(task.dependencies || []).length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {(task.dependencies || []).map((depSer) => {
                    const depTask = ctx.tasks.find((t) => t.serial === depSer);
                    const isDone = depTask?.status === "done";
                    return (
                      <span
                        key={depSer}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] ${isDone ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-300"}`}
                      >
                        <span className="mono font-bold">{depSer}</span>
                        <span className="truncate max-w-[140px]">{depTask?.title || "Linked Task"}</span>
                        <span className="text-[10px] opacity-75">({depTask?.status || "pending"})</span>
                        <button
                          onClick={() =>
                            ctx.updateTask(task.id, {
                              dependencies: (task.dependencies || []).filter((d) => d !== depSer),
                            })
                          }
                          className="ms-1 hover:text-white"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-7">
              <Field label={ctx.t("الوصف", "Description")}>
                <textarea
                  name="auto-field-dvv1hqe"
                  defaultValue={task.description || ""}
                  onBlur={(e) => ctx.updateTask(task.id, { description: e.target.value })}
                  placeholder={ctx.t("أضف وصفاً…", "Add a description…")}
                  className={areaCls}
                />
              </Field>
            </div>

            <div className="mt-7">
              <div className="mb-3 flex items-center gap-2.5">
                <IconSubtask size={15} className="text-indigo-300" />
                <span className="text-[13px] font-semibold text-white">{ctx.t("المهام الفرعية", "Subtasks")}</span>
                <span className="mono rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500 tabular">
                  {subtasks.filter((s) => s.status === "done").length}/{subtasks.length}
                </span>
                {subtasks.length > 0 && (
                  <Bar
                    value={(subtasks.filter((s) => s.status === "done").length / subtasks.length) * 100}
                    className="max-w-[110px]"
                  />
                )}
              </div>
              <div className="space-y-2">
                {subtasks.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
                  >
                    <button
                      onClick={() => toggleSubtask(s)}
                      className={cn(
                        "grid h-4.5 h-5 w-5 place-items-center rounded-md border transition",
                        s.status === "done"
                          ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300"
                          : "border-white/20 text-transparent hover:border-indigo-400/60",
                      )}
                      style={{ height: 18, width: 18 }}
                    >
                      <IconCheck size={10} />
                    </button>
                    <span
                      className={cn(
                        "flex-1 text-[12.5px]",
                        s.status === "done" ? "text-zinc-500 line-through" : "text-zinc-200",
                      )}
                    >
                      {s.title}
                    </span>
                    <span className="mono text-[10px] text-zinc-600">{s.serial}</span>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = e.target as HTMLFormElement;
                    const i = f.elements.namedItem("sub") as HTMLInputElement;
                    addSubtask(i.value);
                    i.value = "";
                  }}
                  className="flex gap-2"
                >
                  <input
                    name="sub"
                    placeholder={ctx.t("مهمة فرعية جديدة…", "New subtask…")}
                    className={cn(inputCls, "flex-1")}
                  />
                  <Btn type="submit" variant="outline">
                    <IconPlus size={14} />
                  </Btn>
                </form>
              </div>
            </div>

            <div className="mt-7">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">{ctx.t("التقدم", "Progress")}</span>
                <span className="mono text-[12px] font-bold text-violet-700 dark:text-violet-300 tabular">
                  {task.progress}%
                </span>
              </div>
              <input
                name="auto-field-liwpg42"
                type="range"
                min={0}
                max={100}
                value={task.progress}
                onChange={(e) => ctx.updateTask(task.id, { progress: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>

            <div className="mt-7">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <IconPaperclip size={15} className="text-violet-700 dark:text-violet-300" />
                  <span className="text-[13px] font-semibold text-white">{ctx.t("المرفقات", "Attachments")}</span>
                  <span className="mono rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500 tabular">
                    {ctx.attachments.length}
                  </span>
                </div>
                <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-white/10 px-3 text-[11px] font-semibold text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.04]">
                  <input
                    name="auto-field-julf0ha"
                    type="file"
                    className="hidden"
                    onChange={async (event) => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      if (file) await ctx.addAttachment(task.id, file);
                      input.value = "";
                    }}
                  />
                  + {ctx.t("رفع ملف", "Upload")}
                </label>
              </div>
              <div className="space-y-2">
                {ctx.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-[12px]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {att.previewUrl && att.previewMimeType?.startsWith("image/") ? (
                        <a
                          href={att.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={ctx.t("معاينة المرفق", "Preview attachment")}
                          className="h-10 w-10 shrink-0 rounded-lg border border-cyan-500/20 bg-cover bg-center"
                          style={{ backgroundImage: `url(${JSON.stringify(att.previewUrl)})` }}
                        />
                      ) : (
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-500/10 text-violet-700 border border-violet-500/20 dark:text-violet-300">
                          <IconDoc size={13} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-zinc-200">{att.fileName}</div>
                        <div className="text-[10px] text-zinc-500 mono tabular">
                          {(att.fileSize / 1024 / 1024).toFixed(2)} MB ·{" "}
                          {new Date(att.createdAt).toLocaleDateString(ctx.locale === "ar" ? "ar-EG" : "en-US")}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {att.previewUrl && (
                        <a
                          href={att.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-violet-600 hover:underline text-[11px] font-semibold dark:text-violet-400"
                        >
                          {ctx.t("معاينة", "Preview")}
                        </a>
                      )}
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-400 hover:underline text-[11px] font-semibold"
                      >
                        {ctx.t("تحميل ↓", "Download ↓")}
                      </a>
                    </div>
                  </div>
                ))}
                {ctx.attachments.length === 0 && (
                  <div className="py-3 text-center text-[11.5px] text-zinc-600 border border-dashed border-white/10 rounded-xl">
                    {ctx.t("لا توجد مرفقات مرتبطة بهذه المهمة", "No attachments linked to this task")}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-7">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-[16px]">🔗</span>
                  <span className="text-[13px] font-semibold text-white">
                    {ctx.t("الروابط والمراجع (Figma, PRs, Docs)", "External Links (Figma, PRs, Docs)")}
                  </span>
                  <span className="mono rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500 tabular">
                    {((task.customFields?.links as any[]) || []).length}
                  </span>
                </div>
                <Btn
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const title = prompt(
                      ctx.t(
                        "عنوان الرابط (مثال: Figma UI Spec أو GitHub PR #42)",
                        "Link Title (e.g. Figma Spec or GitHub PR)",
                      ),
                      "Figma UI Specs",
                    );
                    const url = prompt(ctx.t("الرابط (URL)", "URL"), "https://figma.com/design/calmboard-v2");
                    if (title && url) {
                      const links = [
                        ...((task.customFields?.links as any[]) || []),
                        {
                          id: Date.now(),
                          title,
                          url,
                          icon: url.includes("figma")
                            ? "🎨"
                            : url.includes("github")
                              ? "🐙"
                              : url.includes("google")
                                ? "📑"
                                : "🔗",
                        },
                      ];
                      ctx.updateTask(task.id, { customFields: { ...(task.customFields || {}), links } });
                      ctx.notify(ctx.t("تم إرفاق الرابط بنجاح ✓", "Link attached ✓"));
                    }
                  }}
                >
                  + {ctx.t("إضافة رابط", "Add Link")}
                </Btn>
              </div>
              <div className="space-y-2">
                {((task.customFields?.links as any[]) || []).map((lnk: any, i: number) => (
                  <div
                    key={lnk.id || i}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-[12px]"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {lnk.icon || "🔗"}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-zinc-200">{lnk.title}</div>
                        <div className="text-[10.5px] text-zinc-500 mono truncate">{lnk.url}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={lnk.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-violet-700 hover:underline text-[11px] font-bold dark:text-violet-300"
                      >
                        {ctx.t("فتح ↗", "Open ↗")}
                      </a>
                      <button
                        onClick={() => {
                          const links = ((task.customFields?.links as any[]) || []).filter(
                            (_: any, idx: number) => idx !== i,
                          );
                          ctx.updateTask(task.id, { customFields: { ...(task.customFields || {}), links } });
                        }}
                        className="text-zinc-500 hover:text-rose-400"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
                {((task.customFields?.links as any[]) || []).length === 0 && (
                  <div className="py-3 text-center text-[11.5px] text-zinc-600 border border-dashed border-white/10 rounded-xl">
                    {ctx.t(
                      "لا توجد روابط مضافة، أضف روابط لتصاميم Figma أو فروع GitHub",
                      "No external links attached. Add Figma designs or GitHub PRs",
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8">
              <div className="mb-4 flex items-center gap-2.5">
                <IconComment size={15} className="text-indigo-300" />
                <span className="text-[13px] font-semibold text-white">{ctx.t("التعليقات", "Comments")}</span>
                <span className="mono rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-500 tabular">
                  {comments.length}
                </span>
              </div>
              <div className="flex gap-3">
                <Avatar src={ctx.currentUser?.avatarUrl} name={ctx.currentUser?.name} size={30} />
                <div className="flex-1">
                  <textarea
                    name="auto-field-489335h"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={ctx.t("اكتب تعليقاً… (@ للإشارة)", "Write a comment… (@ to mention)")}
                    className={areaCls}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        addComment(comment);
                        setComment("");
                      }
                    }}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10.5px] text-zinc-600">{ctx.t("⌘+Enter للإرسال", "⌘+Enter to send")}</span>
                    <div className="flex gap-1.5">
                      <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200">
                        <input
                          name="auto-field-pnzuus9"
                          type="file"
                          className="hidden"
                          onChange={async (event) => {
                            const input = event.currentTarget;
                            const file = input.files?.[0];
                            if (file) await ctx.addAttachment(task.id, file);
                            input.value = "";
                          }}
                        />
                        <IconPaperclip size={13} />
                      </label>
                      <Btn size="sm" variant="ghost" onClick={() => setComment((p) => p + " @سارة الخالدي ")}>
                        <IconAt size={13} />
                      </Btn>
                      <Btn
                        size="sm"
                        variant="glow"
                        onClick={() => {
                          addComment(comment);
                          setComment("");
                        }}
                      >
                        <IconSend size={13} />
                        {ctx.t("إرسال", "Send")}
                      </Btn>
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                {[...comments]
                  .sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0))
                  .map((c) => (
                    <div
                      key={c.id}
                      className={`flex gap-3 rounded-xl p-2.5 transition ${c.isPinned ? "border border-amber-500/30 bg-amber-500/[0.05]" : ""}`}
                    >
                      <Avatar src={c.user?.avatarUrl} name={c.user?.name} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[12.5px] font-semibold text-zinc-200">{c.user?.name}</span>
                            {c.isPinned && (
                              <Badge tone="amber" className="!px-1.5 !text-[10px]">
                                📌 {ctx.t("مثبت", "Pinned")}
                              </Badge>
                            )}
                            <span className="text-[10px] text-zinc-600">
                              {new Date(c.createdAt).toLocaleString(ctx.locale === "ar" ? "ar-EG" : "en-US")}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 opacity-80 hover:opacity-100">
                            <button
                              onClick={() => ctx.togglePinComment(c.id, !c.isPinned)}
                              className="text-[11px] text-zinc-400 hover:text-amber-400 px-1"
                              title={ctx.t("تثبيت / إلغاء", "Pin / Unpin")}
                            >
                              {c.isPinned ? "📌" : "📍"}
                            </button>
                            <button
                              onClick={() => {
                                const newText = prompt(ctx.t("تعديل التعليق:", "Edit comment:"), c.content);
                                if (newText && newText.trim()) {
                                  editComment(c.id, newText.trim());
                                }
                              }}
                              className="text-[11px] text-zinc-400 hover:text-indigo-400 px-1"
                              title={ctx.t("تعديل", "Edit")}
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => {
                                if (ctx.createTask) {
                                  ctx.createTask({
                                    title: c.content.slice(0, 80),
                                    description: `تم إنشاؤه من تعليق بواسطة @${c.user?.name || "عضو"}:\n\n> ${c.content}`,
                                  });
                                  ctx.notify(ctx.t("تم تحويل التعليق إلى مهمة ✨", "Comment turned into task ✨"));
                                }
                              }}
                              className="text-[11px] text-slate-600 hover:text-violet-700 px-1 dark:text-zinc-400 dark:hover:text-violet-300"
                              title={ctx.t("تحويل إلى مهمة", "Turn into task")}
                            >
                              ✨
                            </button>
                            <button
                              onClick={() => ctx.deleteComment(c.id)}
                              className="text-[11px] text-zinc-400 hover:text-rose-400 px-1"
                              title={ctx.t("حذف", "Delete")}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                        <div className="mt-1.5 rounded-xl rounded-ss-sm border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-zinc-300">
                          {c.content}
                        </div>
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          {["👍", "❤️", "🎉", "🚀", "👀"].map((em) => {
                            const list = (c.reactions || {})[em] || [];
                            const active = ctx.currentUser && list.includes(ctx.currentUser.name);
                            return (
                              <button
                                key={em}
                                onClick={() => ctx.toggleReaction(c.id, em)}
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] border transition ${active ? "border-indigo-500/40 bg-indigo-500/20 text-indigo-300" : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06]"}`}
                              >
                                <span>{em}</span>
                                {list.length > 0 && <span className="mono font-bold tabular">{list.length}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                {comments.length === 0 && (
                  <div className="py-4 text-center text-[12px] text-zinc-600">
                    {ctx.t("لا تعليقات بعد", "No comments yet")}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-8 flex gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] p-4">
              <IconShield size={16} className="shrink-0 text-indigo-300" />
              <div>
                <div className="text-[12px] font-semibold text-indigo-200">
                  {ctx.t("عزل المستأجرين مفعّل", "Tenant isolation active")}
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  {ctx.t(
                    "كل عملية تُفحص صلاحياتها في الخادم مع RSL وعزل كامل للبيانات.",
                    "Every operation is permission-checked server-side with RLS & full data isolation.",
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
