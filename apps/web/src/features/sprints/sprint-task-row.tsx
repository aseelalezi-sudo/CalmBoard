"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Sprint, Task, ViewCtx } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

export function SprintTaskRow({
  task,
  ctx,
  destinations,
  disabled,
  onMove,
}: {
  task: Task;
  ctx: ViewCtx;
  destinations: Sprint[];
  disabled: boolean;
  onMove: (task: Task, targetSprintId: string | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled,
    data: { type: "sprint-task", task, sourceSprintId: task.sprintId ?? null },
  });
  const status = STATUS_CONFIG[task.status];
  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-white/8 dark:bg-white/4",
        isDragging && "opacity-40 ring-2 ring-indigo-500",
      )}
    >
      {!disabled ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={ctx.t(`نقل المهمة ${task.title}`, `Move task ${task.title}`)}
          className="touch-none cursor-grab rounded-lg px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-indigo-600 focus-ring active:cursor-grabbing dark:hover:bg-white/6"
        >
          ⠿
        </button>
      ) : (
        <span className="w-6" aria-hidden="true" />
      )}

      <button type="button" onClick={() => ctx.openTask(task)} className="min-w-0 text-start focus-ring rounded-md">
        <span className="me-2 font-mono text-[10px] font-semibold text-slate-500 dark:text-zinc-500">
          {task.serial}
        </span>
        <span className="text-[13px] font-medium text-slate-900 dark:text-zinc-100">{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={status?.tone}>{status?.[ctx.locale]}</Badge>
          <Badge tone={priority?.tone}>{priority?.[ctx.locale]}</Badge>
          {task.storyPoints != null && <Badge tone="violet">{task.storyPoints} pts</Badge>}
          {task.assignee?.name && (
            <span className="text-[11px] text-slate-500 dark:text-zinc-400">{task.assignee.name}</span>
          )}
        </span>
      </button>

      {!disabled && (
        <select
          aria-label={ctx.t(`نقل ${task.title} إلى`, `Move ${task.title} to`)}
          value={task.sprintId ?? "backlog"}
          onChange={(event) => onMove(task, event.target.value === "backlog" ? null : event.target.value)}
          className="max-w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-indigo-500 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
        >
          <option value="backlog">{ctx.t("التراكم", "Backlog")}</option>
          {destinations.map((sprint) => (
            <option key={sprint.id} value={sprint.id}>
              {sprint.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
