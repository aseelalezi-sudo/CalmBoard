"use client";

import { useRef, useState, type MouseEvent } from "react";
import type { Task, ViewCtx } from "@/lib/types";
import { TaskAssigneeStack } from "./task-assignee-stack";
import { TaskAssigneePicker } from "./task-assignee-picker";

export type TaskAssignmentControlProps = {
  task: Task;
  ctx: ViewCtx;
  size?: number;
  maxVisible?: number;
  showLabel?: boolean;
  className?: string;
  disabled?: boolean;
};

export function TaskAssignmentControl({
  task,
  ctx,
  size = 22,
  maxVisible = 3,
  showLabel = false,
  className,
  disabled = false,
}: TaskAssignmentControlProps) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const canEdit = ctx.can("tasks.update") && !disabled;

  const handleTriggerClick = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();

    if (isPending) return;

    if (triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
    setIsOpen(true);
  };

  const handleSave = async (result: import("./assignment-domain").AssignmentMutationPayload): Promise<boolean> => {
    if (isPending) return false;
    setIsPending(true);

    try {
      const success = await ctx.updateTask(task.id, {
        expectedVersion: task.version,
        ...(result.assigneeId !== undefined ? { assigneeId: result.assigneeId } : {}),
        assigneeIds: result.assigneeIds,
      });

      if (!success) {
        ctx.notify?.(
          ctx.t(
            "تعذر تحديث المسؤولين؛ قد تكون المهمة عُدلت في مكان آخر. يُرجى إعادة المحاولة.",
            "Could not update assignees; task may have been modified elsewhere. Please retry.",
          ),
          "error",
        );
        return false;
      }
      return true;
    } catch {
      ctx.notify?.(
        ctx.t("تعذر تحديث المسؤولين. حاول مجدداً.", "Could not update assignees. Please try again."),
        "error",
      );
      return false;
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex items-center max-w-full"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <TaskAssigneeStack
        task={task}
        users={ctx.users}
        members={ctx.members}
        size={size}
        maxVisible={maxVisible}
        showLabel={showLabel}
        interactive={canEdit && !isPending}
        disabled={isPending || disabled}
        onClick={handleTriggerClick}
        className={className}
        t={ctx.t}
        locale={ctx.locale}
      />

      {isOpen && (
        <TaskAssigneePicker
          task={task}
          users={ctx.users}
          members={ctx.members}
          canEdit={canEdit && !isPending}
          anchorRect={anchorRect}
          onSave={handleSave}
          onClose={() => setIsOpen(false)}
          t={ctx.t}
          locale={ctx.locale}
        />
      )}
    </div>
  );
}
