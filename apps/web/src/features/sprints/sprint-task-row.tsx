"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Sprint, Task, ViewCtx } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG, fmtNumber } from "@/lib/types";
import { Badge, selectCls } from "@/components/ui";
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
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2.5 shadow-xs",
        isDragging && "opacity-40 ring-2 ring-accent",
      )}
    >
      {!disabled ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={ctx.t(`نقل المهمة ${task.title}`, `Move task ${task.title}`)}
          className="touch-none cursor-grab rounded-lg px-1.5 py-1 text-ink-faint hover:bg-surface hover:text-accent focus-ring active:cursor-grabbing"
        >
          ⠿
        </button>
      ) : (
        <span className="w-6" aria-hidden="true" />
      )}

      <button type="button" onClick={() => ctx.openTask(task)} className="min-w-0 text-start focus-ring rounded-md">
        <span className="me-2 font-mono text-[10px] font-semibold text-ink-faint">{task.serial}</span>
        <span className="text-[13px] font-medium text-ink">{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={status?.tone}>{status?.[ctx.locale]}</Badge>
          <Badge tone={priority?.tone}>{priority?.[ctx.locale]}</Badge>
          {task.storyPoints != null && <Badge tone="violet">{fmtNumber(task.storyPoints, ctx.locale)} pts</Badge>}
          {task.assignee?.name && <span className="text-[11px] text-ink-soft">{task.assignee.name}</span>}
        </span>
      </button>

      {!disabled && (
        <select
          aria-label={ctx.t(`نقل ${task.title} إلى`, `Move ${task.title} to`)}
          value={task.sprintId ?? "backlog"}
          onChange={(event) => onMove(task, event.target.value === "backlog" ? null : event.target.value)}
          className={`${selectCls} max-w-32 py-1 text-[11px]`}
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
