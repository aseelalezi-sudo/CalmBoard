"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Sprint, Task, ViewCtx } from "@/lib/types";
import { fmtDate, fmtNumber } from "@/lib/types";
import { Badge, Bar, Btn } from "@/components/ui";
import { IconRocket } from "@/components/icons";
import { cn } from "@/lib/utils";
import { sprintSummary } from "./sprint-domain";
import { SprintTaskRow } from "./sprint-task-row";

const statusTone = { planned: "neutral", active: "emerald", completed: "indigo", cancelled: "rose" } as const;

export function SprintSection({
  sprint,
  tasks,
  ctx,
  destinations,
  readOnly,
  pending = false,
  activeSprintExists,
  onMove,
  onEdit,
  onStart,
  onComplete,
  onCancel,
}: {
  sprint: Sprint | null;
  tasks: Task[];
  ctx: ViewCtx;
  destinations: Sprint[];
  readOnly: boolean;
  pending?: boolean;
  activeSprintExists: boolean;
  onMove: (task: Task, targetSprintId: string | null) => void;
  onEdit?: () => void;
  onStart?: () => void;
  onComplete?: () => void;
  onCancel?: () => void;
}) {
  const historical = Boolean(sprint && ["completed", "cancelled"].includes(sprint.status));
  const disabled = readOnly || historical || pending;
  const { setNodeRef, isOver } = useDroppable({
    id: `sprint-drop:${sprint?.id ?? "backlog"}`,
    data: { type: "sprint-container", targetSprintId: sprint?.id ?? null },
    disabled,
  });
  const summary = sprintSummary(tasks);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "rounded-2xl border border-line bg-surface p-4",
        sprint?.status === "active" && "border-accent/30 bg-accent/5",
        isOver && "ring-2 ring-accent",
      )}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
              <IconRocket size={15} />
            </span>
            <h3 className="truncate text-base font-semibold text-ink">{sprint?.name ?? ctx.t("التراكم", "Backlog")}</h3>
            {sprint && <Badge tone={statusTone[sprint.status]}>{sprint.status}</Badge>}
            <Badge>
              {fmtNumber(summary.taskCount, ctx.locale)} {ctx.t("مهمة", "tasks")}
            </Badge>
            <Badge tone="violet">{fmtNumber(summary.storyPoints, ctx.locale)} pts</Badge>
          </div>
          {sprint?.goal && <p className="mt-2 text-[12px] text-slate-600 dark:text-zinc-400">{sprint.goal}</p>}
          {sprint && (sprint.startsAt || sprint.endsAt) && (
            <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-500">
              {fmtDate(sprint.startsAt, ctx.locale)}
              {sprint.startsAt && sprint.endsAt ? " – " : ""}
              {fmtDate(sprint.endsAt, ctx.locale)}
            </p>
          )}
          {sprint?.status === "active" && (
            <div className="mt-3 max-w-sm">
              <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                <span>
                  {summary.completedCount}/{summary.taskCount} {ctx.t("مكتملة", "completed")}
                </span>
                <span>{summary.progress}%</span>
              </div>
              <Bar value={summary.progress} />
            </div>
          )}
        </div>

        {!readOnly && sprint && !historical && (
          <div className="flex flex-wrap gap-2">
            {sprint.status === "planned" && onEdit && (
              <Btn size="sm" onClick={onEdit}>
                {ctx.t("تعديل", "Edit")}
              </Btn>
            )}
            {sprint.status === "planned" && onStart && (
              <Btn size="sm" variant="primary" disabled={activeSprintExists} onClick={onStart}>
                {ctx.t("بدء السبرنت", "Start Sprint")}
              </Btn>
            )}
            {sprint.status === "active" && onComplete && (
              <Btn size="sm" variant="primary" onClick={onComplete}>
                {ctx.t("إكمال", "Complete")}
              </Btn>
            )}
            {sprint.status === "active" && onCancel && (
              <Btn size="sm" variant="danger" onClick={onCancel}>
                {ctx.t("إلغاء السبرنت", "Cancel Sprint")}
              </Btn>
            )}
          </div>
        )}
      </header>

      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-16 flex-col gap-2 rounded-xl border border-dashed border-slate-200 p-2 dark:border-white/8">
          {tasks.length ? (
            tasks.map((task) => (
              <SprintTaskRow
                key={task.id}
                task={task}
                ctx={ctx}
                destinations={destinations}
                disabled={disabled}
                onMove={onMove}
              />
            ))
          ) : (
            <div className="grid min-h-12 place-items-center text-[12px] text-slate-400 dark:text-zinc-500">
              {disabled ? ctx.t("لا توجد مهام", "No tasks") : ctx.t("اسحب المهام هنا", "Drop tasks here")}
            </div>
          )}
        </div>
      </SortableContext>
    </section>
  );
}
