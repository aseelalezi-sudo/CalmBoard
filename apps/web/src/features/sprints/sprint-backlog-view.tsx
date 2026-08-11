"use client";

import { useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Sprint, Task, ViewCtx } from "@/lib/types";
import { ApiError } from "@/lib/client-api";
import { Btn, Card } from "@/components/ui";
import { IconPlus, IconRocket } from "@/components/icons";
import type { CompleteSprintDestination, SprintFormInput } from "./api";
import { groupSprintPlanning } from "./sprint-domain";
import { SprintSection } from "./sprint-section";
import { CancelSprintDialog, CompleteSprintDialog, SprintFormDialog, StartSprintDialog } from "./sprint-dialogs";
import { useSprintOperations, useSprints } from "./use-sprints";

type DialogState =
  | { type: "create" }
  | { type: "edit"; sprint: Sprint }
  | { type: "start"; sprint: Sprint }
  | { type: "complete"; sprint: Sprint }
  | { type: "cancel"; sprint: Sprint }
  | null;

export function SprintBacklogView({ ctx }: { ctx: ViewCtx }) {
  const project = ctx.activeProject;
  const sprintQuery = useSprints(project, ctx.currentUser?.id);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draggedTask, setDraggedTask] = useState<Task | null>(null);
  const operations = useSprintOperations(project, ctx.currentUser?.id, { onTasksChanged: ctx.refreshProjectTasks });
  const canManage = ctx.can("sprints.manage");
  const sprints = useMemo(() => sprintQuery.data ?? [], [sprintQuery.data]);
  const planning = useMemo(
    () =>
      project
        ? groupSprintPlanning(ctx.tasks, sprints, project.id)
        : { backlog: [], bySprint: new Map<string, Task[]>(), writableTasks: [] },
    [ctx.tasks, project, sprints],
  );
  const activeSprint = sprints.find((sprint) => sprint.status === "active") ?? null;
  const plannedSprints = sprints.filter((sprint) => sprint.status === "planned");
  const pastSprints = sprints
    .filter((sprint) => sprint.status === "completed" || sprint.status === "cancelled")
    .sort(
      (a, b) =>
        new Date(b.completedAt ?? b.cancelledAt ?? b.updatedAt).getTime() -
        new Date(a.completedAt ?? a.cancelledAt ?? a.updatedAt).getTime(),
    );
  const writableDestinations = [...(activeSprint ? [activeSprint] : []), ...plannedSprints];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!project) return null;
  if (!ctx.can("sprints.view")) {
    return (
      <Card className="p-8 text-center text-sm text-slate-600 dark:text-zinc-400">
        {ctx.t("ليست لديك صلاحية عرض السبرنتات.", "You do not have permission to view Sprints.")}
      </Card>
    );
  }
  if (sprintQuery.isLoading) {
    return (
      <div className="space-y-4" aria-label={ctx.t("جارٍ تحميل السبرنتات", "Loading Sprints")}>
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-2xl bg-slate-200/70 dark:bg-white/5" />
        ))}
      </div>
    );
  }
  if (sprintQuery.isError) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {ctx.t("تعذر تحميل السبرنتات.", "Could not load Sprints.")}
        </p>
        <Btn className="mt-4" onClick={() => void sprintQuery.refetch()}>
          {ctx.t("إعادة المحاولة", "Try again")}
        </Btn>
      </Card>
    );
  }

  const notifyError = (error: unknown, conflictMessage?: string) => {
    const message =
      error instanceof ApiError && error.status === 409
        ? (conflictMessage ??
          ctx.t(
            "تغيّرت بيانات السبرنت في مكان آخر. تم تحديث العرض.",
            "Sprint data changed elsewhere. The view was refreshed.",
          ))
        : error instanceof Error
          ? error.message
          : ctx.t("تعذر تنفيذ الإجراء", "Action failed");
    ctx.notify(message, "error");
  };

  const moveTask = async (task: Task, targetSprintId: string | null) => {
    if (!canManage || (task.sprintId ?? null) === targetSprintId) return;
    const expectedFromSprintId = task.sprintId ?? null;
    ctx.setTaskSprintMembership(task.id, targetSprintId);
    try {
      await operations.moveTask({ taskId: task.id, targetSprintId, expectedFromSprintId });
      ctx.notify(ctx.t("تم نقل المهمة", "Task moved"));
    } catch (error) {
      ctx.setTaskSprintMembership(task.id, expectedFromSprintId);
      await Promise.all([ctx.refreshProjectTasks(), sprintQuery.refetch()]);
      notifyError(
        error,
        ctx.t(
          "نُقلت المهمة من مصدر آخر؛ تم التراجع وتحديث التخطيط.",
          "Task membership changed elsewhere; the move was rolled back and planning refreshed.",
        ),
      );
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggedTask(null);
    if (!canManage || !event.over) return;
    const task = ctx.tasks.find((candidate) => candidate.id === String(event.active.id));
    if (!task) return;
    const overTask = ctx.tasks.find((candidate) => candidate.id === String(event.over?.id));
    const targetSprintId = overTask
      ? (overTask.sprintId ?? null)
      : event.over.data.current?.type === "sprint-container"
        ? (event.over.data.current.targetSprintId as string | null)
        : undefined;
    if (targetSprintId !== undefined) void moveTask(task, targetSprintId);
  };

  const execute = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setDialog(null);
      ctx.notify(success);
    } catch (error) {
      notifyError(error);
    }
  };
  const dialogSprint = dialog && "sprint" in dialog ? dialog.sprint : null;
  const dialogTasks = dialogSprint ? (planning.bySprint.get(dialogSprint.id) ?? []) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <IconRocket className="text-indigo-600 dark:text-indigo-300" />
            <h2 className="text-xl font-bold text-slate-950 dark:text-white">
              {ctx.t("السبرنتات والتراكم", "Sprints & Backlog")}
            </h2>
          </div>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-zinc-400">
            {ctx.t(
              "خطط وقت تنفيذ مهام المشروع دون تغيير مسار العمل.",
              "Plan when project tasks happen without changing their workflow.",
            )}
          </p>
          {!canManage && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              {ctx.t("عرض للقراءة فقط", "Read-only view")}
            </p>
          )}
        </div>
        {canManage && (
          <Btn variant="primary" onClick={() => setDialog({ type: "create" })}>
            <IconPlus size={15} />
            {ctx.t("إنشاء سبرنت", "Create Sprint")}
          </Btn>
        )}
      </div>

      {!sprints.length && (
        <Card className="p-10 text-center">
          <IconRocket className="mx-auto text-indigo-500" size={28} />
          <h3 className="mt-3 font-semibold text-slate-950 dark:text-white">
            {ctx.t("لا توجد سبرنتات بعد", "No Sprints yet")}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {ctx.t(
              "يمكنك إبقاء المشروع عادياً أو إنشاء أول سبرنت عند الحاجة.",
              "Keep this as a regular project, or create the first Sprint when needed.",
            )}
          </p>
          {canManage && (
            <Btn className="mt-4" onClick={() => setDialog({ type: "create" })}>
              {ctx.t("إنشاء أول سبرنت", "Create first Sprint")}
            </Btn>
          )}
        </Card>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(event: DragStartEvent) =>
          setDraggedTask(ctx.tasks.find((task) => task.id === String(event.active.id)) ?? null)
        }
        onDragCancel={() => setDraggedTask(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="space-y-5">
          {activeSprint && (
            <SprintSection
              sprint={activeSprint}
              tasks={planning.bySprint.get(activeSprint.id) ?? []}
              ctx={ctx}
              destinations={writableDestinations}
              readOnly={!canManage}
              activeSprintExists
              onMove={moveTask}
              onComplete={() => setDialog({ type: "complete", sprint: activeSprint })}
              onCancel={() => setDialog({ type: "cancel", sprint: activeSprint })}
            />
          )}
          {plannedSprints.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
                {ctx.t("السبرنتات المخططة", "Planned Sprints")}
              </h3>
              {plannedSprints.map((sprint) => (
                <SprintSection
                  key={sprint.id}
                  sprint={sprint}
                  tasks={planning.bySprint.get(sprint.id) ?? []}
                  ctx={ctx}
                  destinations={writableDestinations}
                  readOnly={!canManage}
                  activeSprintExists={Boolean(activeSprint)}
                  onMove={moveTask}
                  onEdit={() => setDialog({ type: "edit", sprint })}
                  onStart={() => setDialog({ type: "start", sprint })}
                />
              ))}
            </div>
          )}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
              {ctx.t("التراكم", "Backlog")}
            </h3>
            <SprintSection
              sprint={null}
              tasks={planning.backlog}
              ctx={ctx}
              destinations={writableDestinations}
              readOnly={!canManage}
              activeSprintExists={Boolean(activeSprint)}
              onMove={moveTask}
            />
          </div>
        </div>
        <DragOverlay>
          {draggedTask && (
            <div className="max-w-sm rounded-xl border border-indigo-400 bg-white px-3 py-2 text-sm font-medium shadow-2xl dark:bg-zinc-900 dark:text-white">
              {draggedTask.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {pastSprints.length > 0 && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-white/2">
          <summary className="cursor-pointer font-semibold text-slate-900 dark:text-white">
            {ctx.t("السبرنتات السابقة", "Past Sprints")} ({pastSprints.length})
          </summary>
          <div className="mt-4 space-y-3">
            {pastSprints.map((sprint) => (
              <SprintSection
                key={sprint.id}
                sprint={sprint}
                tasks={planning.bySprint.get(sprint.id) ?? []}
                ctx={ctx}
                destinations={[]}
                readOnly
                activeSprintExists={Boolean(activeSprint)}
                onMove={() => undefined}
              />
            ))}
          </div>
        </details>
      )}

      <SprintFormDialog
        open={dialog?.type === "create" || dialog?.type === "edit"}
        sprint={dialog?.type === "edit" ? dialog.sprint : null}
        defaultName={`Sprint ${sprints.length + 1}`}
        ctx={ctx}
        pending={operations.pendingAction}
        onClose={() => setDialog(null)}
        onSubmit={(input: SprintFormInput) =>
          execute(
            () =>
              dialog?.type === "edit"
                ? operations.update({ sprintId: dialog.sprint.id, input })
                : operations.create(input),
            ctx.t("تم حفظ السبرنت", "Sprint saved"),
          )
        }
      />
      <StartSprintDialog
        sprint={dialog?.type === "start" ? dialog.sprint : null}
        tasks={dialog?.type === "start" ? dialogTasks : []}
        ctx={ctx}
        pending={operations.pendingAction}
        onClose={() => setDialog(null)}
        onConfirm={() => execute(() => operations.start(dialogSprint!.id), ctx.t("بدأ السبرنت", "Sprint started"))}
      />
      <CompleteSprintDialog
        sprint={dialog?.type === "complete" ? dialog.sprint : null}
        tasks={dialog?.type === "complete" ? dialogTasks : []}
        plannedSprints={plannedSprints}
        ctx={ctx}
        pending={operations.pendingAction}
        onClose={() => setDialog(null)}
        onConfirm={(destination: CompleteSprintDestination) =>
          execute(
            () => operations.complete({ sprintId: dialogSprint!.id, destination }),
            ctx.t("اكتمل السبرنت", "Sprint completed"),
          )
        }
      />
      <CancelSprintDialog
        sprint={dialog?.type === "cancel" ? dialog.sprint : null}
        tasks={dialog?.type === "cancel" ? dialogTasks : []}
        ctx={ctx}
        pending={operations.pendingAction}
        onClose={() => setDialog(null)}
        onConfirm={() =>
          execute(
            () => operations.cancel(dialogSprint!.id),
            ctx.t("أُلغي السبرنت وأعيدت المهام إلى التراكم", "Sprint cancelled and tasks returned to Backlog"),
          )
        }
      />
    </div>
  );
}
