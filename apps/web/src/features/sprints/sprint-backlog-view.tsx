"use client";

import { useMemo, useRef, useState } from "react";
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
import { fmtNumber } from "@/lib/types";
import { Btn, Card, ScreenHeader, ScreenState } from "@/components/ui";
import { IconPlus, IconRocket, IconShield } from "@/components/icons";
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
  const [busy, setBusy] = useState(false);
  const operationLockRef = useRef(false);

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

  const runExclusive = async <T,>(action: () => Promise<T>): Promise<T | null> => {
    if (operationLockRef.current) return false as unknown as T;
    operationLockRef.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      operationLockRef.current = false;
      setBusy(false);
    }
  };

  if (!project) return null;

  if (!ctx.can("sprints.view")) {
    return (
      <ScreenState
        tone="permission"
        icon={<IconShield size={20} />}
        title={ctx.t("صلاحية السبرنتات مطلوبة", "Sprint permission required")}
        description={ctx.t("ليست لديك صلاحية عرض السبرنتات.", "You do not have permission to view Sprints.")}
      />
    );
  }

  if (sprintQuery.isLoading) {
    return (
      <ScreenState
        tone="loading"
        icon={<IconRocket size={20} />}
        title={ctx.t("جارٍ تحميل السبرنتات…", "Loading Sprints…")}
      />
    );
  }

  if (sprintQuery.isError) {
    return (
      <ScreenState
        tone="error"
        icon={<IconRocket size={20} />}
        title={ctx.t("تعذر تحميل السبرنتات", "Could not load Sprints")}
        description={ctx.t("تحقق من الاتصال بالخادم ثم حاول مجدداً.", "Check server connection and try again.")}
        action={<Btn onClick={() => void sprintQuery.refetch()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
      />
    );
  }

  const moveTask = async (task: Task, targetSprintId: string | null) => {
    if (!canManage || (task.sprintId ?? null) === targetSprintId) return;
    const expectedFromSprintId = task.sprintId ?? null;
    ctx.setTaskSprintMembership(task.id, targetSprintId);

    const completed = await runExclusive(async () => {
      try {
        await operations.moveTask({ taskId: task.id, targetSprintId, expectedFromSprintId });
        ctx.notify(ctx.t("تم نقل المهمة", "Task moved"));
        return true;
      } catch {
        ctx.setTaskSprintMembership(task.id, expectedFromSprintId);
        await Promise.all([ctx.refreshProjectTasks(), sprintQuery.refetch()]);
        ctx.notify(
          ctx.t("تعذر تنفيذ إجراء السبرنت. تم التراجع وتحديث التخطيط.", "Could not move task. Reverted and refreshed."),
          "error",
        );
        return false;
      }
    });

    if (!completed) {
      ctx.setTaskSprintMembership(task.id, expectedFromSprintId);
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
    const completed = await runExclusive(async () => {
      try {
        await action();
        setDialog(null);
        ctx.notify(success);
        return true;
      } catch {
        ctx.notify(
          ctx.t("تعذر تنفيذ إجراء السبرنت. تحقق من البيانات والاتصال.", "Action failed. Check connection and details."),
          "error",
        );
        return false;
      }
    });
  };

  const dialogSprint = dialog && "sprint" in dialog ? dialog.sprint : null;
  const dialogTasks = dialogSprint ? (planning.bySprint.get(dialogSprint.id) ?? []) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ScreenHeader
        title={ctx.t("السبرنتات والتراكم", "Sprints & Backlog")}
        description={ctx.t(
          "خطط وقت تنفيذ مهام المشروع دون تغيير مسار العمل.",
          "Plan when project tasks happen without changing their workflow.",
        )}
        actions={
          canManage ? (
            <Btn variant="glow" onClick={() => setDialog({ type: "create" })}>
              <IconPlus size={15} />
              {ctx.t("إنشاء سبرنت", "Create Sprint")}
            </Btn>
          ) : undefined
        }
      />

      {!sprints.length && (
        <ScreenState
          tone="empty"
          icon={<IconRocket className="text-accent" size={24} />}
          title={ctx.t("لا توجد سبرنتات بعد", "No Sprints yet")}
          description={ctx.t(
            "يمكنك إبقاء المشروع عادياً أو إنشاء أول سبرنت عند الحاجة.",
            "Keep this as a regular project, or create the first Sprint when needed.",
          )}
          action={
            canManage ? (
              <Btn onClick={() => setDialog({ type: "create" })}>{ctx.t("إنشاء أول سبرنت", "Create first Sprint")}</Btn>
            ) : undefined
          }
        />
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
              pending={busy || operations.pendingAction}
              activeSprintExists
              onMove={moveTask}
              onComplete={() => setDialog({ type: "complete", sprint: activeSprint })}
              onCancel={() => setDialog({ type: "cancel", sprint: activeSprint })}
            />
          )}
          {plannedSprints.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-ink-faint">
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
                  pending={busy || operations.pendingAction}
                  activeSprintExists={Boolean(activeSprint)}
                  onMove={moveTask}
                  onEdit={() => setDialog({ type: "edit", sprint })}
                  onStart={() => setDialog({ type: "start", sprint })}
                />
              ))}
            </div>
          )}
          <div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-faint">
              {ctx.t("التراكم", "Backlog")}
            </h3>
            <SprintSection
              sprint={null}
              tasks={planning.backlog}
              ctx={ctx}
              destinations={writableDestinations}
              readOnly={!canManage}
              pending={busy || operations.pendingAction}
              activeSprintExists={Boolean(activeSprint)}
              onMove={moveTask}
            />
          </div>
        </div>
        <DragOverlay>
          {draggedTask && (
            <div className="max-w-sm rounded-xl border border-accent bg-surface px-3 py-2 text-sm font-medium shadow-2xl">
              {draggedTask.title}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {pastSprints.length > 0 && (
        <details className="rounded-2xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-semibold text-ink">
            {ctx.t("السبرنتات السابقة", "Past Sprints")} ({fmtNumber(pastSprints.length, ctx.locale)})
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
        defaultName={`السبرنت ${fmtNumber(sprints.length + 1, ctx.locale)}`}
        ctx={ctx}
        pending={busy || operations.pendingAction}
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
        pending={busy || operations.pendingAction}
        onClose={() => setDialog(null)}
        onConfirm={() => execute(() => operations.start(dialogSprint!.id), ctx.t("بدأ السبرنت", "Sprint started"))}
      />
      <CompleteSprintDialog
        sprint={dialog?.type === "complete" ? dialog.sprint : null}
        tasks={dialog?.type === "complete" ? dialogTasks : []}
        plannedSprints={plannedSprints}
        ctx={ctx}
        pending={busy || operations.pendingAction}
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
        pending={busy || operations.pendingAction}
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
