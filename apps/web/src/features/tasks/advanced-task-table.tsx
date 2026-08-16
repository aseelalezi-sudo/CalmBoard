"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Avatar, Badge, Btn, Card, Empty, selectCls } from "@/components/ui";
import {
  IconChevronDown,
  IconFolder,
  IconPlus,
  IconSearch,
  IconSubtask,
  IconTrash,
  IconTrend,
  IconX,
} from "@/components/icons";
import { confirmAction } from "@/components/feedback";
import type { Task, ViewCtx } from "@/lib/types";
import { fmtDate, fmtMinutes, fmtNumber, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBulkTaskActions } from "./use-bulk-task-actions";
import { parseTaskClipboard, serializeTasksForClipboard, type TaskClipboardUpdate } from "./task-table-clipboard";
import { moveTableColumn } from "./task-table-state";
import { useTaskViewStateStore } from "@/stores/task-view-state-store";

const columnLabels: Record<string, { ar: string; en: string }> = {
  title: { ar: "المهمة", en: "Task" },
  status: { ar: "الحالة", en: "Status" },
  priority: { ar: "الأولوية", en: "Priority" },
  assignee: { ar: "المسؤول", en: "Assignee" },
  points: { ar: "النقاط", en: "Points" },
  estimate: { ar: "التقدير", en: "Estimate" },
  logged: { ar: "المسجل", en: "Logged" },
  due: { ar: "الموعد", en: "Due" },
};

function pinnedColumnStyle(column: Column<Task>) {
  const pinned = column.getIsPinned();
  return {
    insetInlineStart: pinned === "left" ? `${column.getStart("left")}px` : undefined,
    insetInlineEnd: pinned === "right" ? `${column.getAfter("right")}px` : undefined,
    position: pinned ? ("sticky" as const) : ("relative" as const),
    width: column.getSize(),
    zIndex: pinned ? 2 : 0,
  };
}

function exportTasksCsv(tasks: Task[]) {
  const head = ["Serial", "Title", "Status", "Priority", "Assignee", "Points", "Estimate", "Logged", "Due"];
  const rows = tasks.map((task) =>
    [
      task.serial,
      `"${(task.title || "").replace(/"/g, '""')}"`,
      task.status,
      task.priority,
      `"${(task.assignee?.name || "").replace(/"/g, '""')}"`,
      task.storyPoints ?? "",
      task.estimatedHours ?? "",
      task.loggedHours ?? "",
      task.dueDate ? new Date(task.dueDate).toISOString().split("T")[0] : "",
    ].join(","),
  );
  const blob = new Blob(["\uFEFF" + [head.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `calmboard-tasks-${new Date().toISOString().split("T")[0]}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function isTextEditingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  if (element.isContentEditable || element.closest("[contenteditable='true']")) return true;
  const field = element.closest("input, textarea, select");
  return Boolean(field && !(field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)));
}

export function AdvancedTaskTable({ ctx }: { ctx: ViewCtx }) {
  const { deleteTasks } = useBulkTaskActions(ctx.tasks, ctx.currentUser?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnsTriggerRef = useRef<HTMLButtonElement>(null);
  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const tableViewState = useTaskViewStateStore((state) => state.table);
  const setTableViewState = useTaskViewStateStore((state) => state.setTable);
  const resetTableViewState = useTaskViewStateStore((state) => state.resetTable);
  const sorting = tableViewState.sorting as SortingState;
  const columnVisibility = tableViewState.columnVisibility as VisibilityState;
  const columnOrder = tableViewState.columnOrder as ColumnOrderState;
  const columnPinning = tableViewState.columnPinning as ColumnPinningState;
  const columnSizing = tableViewState.columnSizing as ColumnSizingState;
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showColumns, setShowColumns] = useState(false);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [newRowTitle, setNewRowTitle] = useState("");
  const [newRowSubmitting, setNewRowSubmitting] = useState(false);
  const [groupBy, setGroupBy] = useState<"none" | "status" | "priority" | "custom">("none");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [groupQuickAdd, setGroupQuickAdd] = useState<Record<string, string>>({});
  const [groupQuickAddSubmitting, setGroupQuickAddSubmitting] = useState<Record<string, boolean>>({});

  // Custom Groups (Sub-tables)
  const [customGroups, setCustomGroups] = useState<
    Array<{ id: string; name: string; color: string; taskIds: string[] }>
  >([
    {
      id: "grp-1",
      name: ctx.locale === "ar" ? "المرحلة الأولى (Phase 1)" : "Phase 1",
      color: "indigo",
      taskIds: [],
    },
    {
      id: "grp-2",
      name: ctx.locale === "ar" ? "قائمة المؤجلات (Backlog)" : "Backlog",
      color: "emerald",
      taskIds: [],
    },
  ]);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("indigo");

  // Inline Subtasks in Table
  const [expandedSubtaskTaskIds, setExpandedSubtaskTaskIds] = useState<Record<string, boolean>>({});
  const [inlineSubtaskInput, setInlineSubtaskInput] = useState<Record<string, string>>({});
  const [inlineSubtaskSubmitting, setInlineSubtaskSubmitting] = useState<Record<string, boolean>>({});

  const subtasksByParentId = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of ctx.tasks) {
      if (task.parentId) {
        const list = map.get(task.parentId) || [];
        list.push(task);
        map.set(task.parentId, list);
      }
    }
    return map;
  }, [ctx.tasks]);

  useEffect(() => {
    if (!showColumns) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (
        columnsMenuRef.current &&
        !columnsMenuRef.current.contains(event.target as Node) &&
        columnsTriggerRef.current &&
        !columnsTriggerRef.current.contains(event.target as Node)
      ) {
        setShowColumns(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowColumns(false);
        columnsTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showColumns]);

  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: "select",
        size: 44,
        minSize: 44,
        maxSize: 44,
        enableHiding: false,
        enableSorting: false,
        enableResizing: false,
        header: ({ table }) => (
          <input
            name="select-all-tasks"
            aria-label={ctx.t("تحديد جميع المهام", "Select all tasks")}
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(node) => {
              if (node) node.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="h-4 w-4 rounded accent-accent"
          />
        ),
        cell: ({ row }) => (
          <input
            name={`select-task-${row.original.id}`}
            aria-label={ctx.t(`تحديد ${row.original.title}`, `Select ${row.original.title}`)}
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 rounded accent-accent"
          />
        ),
      },
      {
        id: "title",
        accessorKey: "title",
        size: 320,
        minSize: 190,
        header: ctx.t("المهمة", "Task"),
        cell: ({ row }) => {
          const priority = PRIORITY_CONFIG[row.original.priority];
          const taskSubtasks = subtasksByParentId.get(row.original.id) || [];
          const hasSubtasks = taskSubtasks.length > 0;
          const isExpanded = expandedSubtaskTaskIds[row.original.id];
          const doneSubtasks = taskSubtasks.filter((s) => s.status === "done").length;

          return (
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                title={ctx.t("عرض/إضافة المهام الفرعية", "Toggle subtasks")}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedSubtaskTaskIds((prev) => ({
                    ...prev,
                    [row.original.id]: !prev[row.original.id],
                  }));
                }}
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded transition hover:bg-raised text-ink-faint hover:text-ink",
                  isExpanded && "text-accent",
                )}
              >
                <IconChevronDown
                  size={12}
                  className={cn(
                    "transition-transform duration-150",
                    isExpanded ? "rotate-0" : "-rotate-90 rtl:rotate-90",
                  )}
                />
              </button>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priority?.bar}`} />
              <span className="mono shrink-0 rounded bg-raised px-1 py-0.5 text-[10px] text-ink-faint">
                {row.original.serial}
              </span>
              <span className="truncate font-semibold text-ink">{row.original.title}</span>
              {hasSubtasks && (
                <span
                  title={ctx.t("المهام الفرعية المنجزة", "Completed subtasks")}
                  className={cn(
                    "mono ms-auto shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold",
                    doneSubtasks === taskSubtasks.length
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-raised text-ink-faint",
                  )}
                >
                  <IconSubtask size={9} />
                  {doneSubtasks}/{taskSubtasks.length}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "status",
        accessorKey: "status",
        size: 145,
        minSize: 115,
        header: ctx.t("الحالة", "Status"),
        cell: ({ row }) => {
          const st = STATUS_CONFIG[row.original.status] || STATUS_CONFIG.todo;
          return (
            <div className="relative inline-flex items-center" onClick={(event) => event.stopPropagation()}>
              <Badge tone={st.tone} className="cursor-pointer font-medium hover:opacity-85 transition-opacity">
                <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                <span>{ctx.t(st.ar, st.en)}</span>
              </Badge>
              <select
                name={`task-status-${row.original.id}`}
                value={row.original.status}
                disabled={!ctx.can("tasks.update")}
                onChange={(event) =>
                  ctx.updateTask(row.original.id, {
                    status: event.target.value,
                    progress: event.target.value === "done" ? 100 : undefined,
                  })
                }
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={ctx.t("تغيير الحالة", "Change status")}
              >
                {Object.entries(STATUS_CONFIG).map(([key, value]) => (
                  <option key={key} value={key}>
                    {ctx.t(value.ar, value.en)}
                  </option>
                ))}
              </select>
            </div>
          );
        },
      },
      {
        id: "priority",
        accessorFn: (task) => PRIORITY_CONFIG[task.priority]?.weight ?? 0,
        size: 120,
        minSize: 95,
        header: ctx.t("الأولوية", "Priority"),
        cell: ({ row }) => {
          const priority = PRIORITY_CONFIG[row.original.priority];
          return (
            <div className="relative inline-flex items-center" onClick={(event) => event.stopPropagation()}>
              <Badge tone={priority?.tone} className="cursor-pointer font-medium hover:opacity-85 transition-opacity">
                {priority?.[ctx.locale === "ar" ? "ar" : "en"]}
              </Badge>
              <select
                name={`task-priority-${row.original.id}`}
                value={row.original.priority}
                disabled={!ctx.can("tasks.update")}
                onChange={(event) =>
                  ctx.updateTask(row.original.id, {
                    priority: event.target.value as Task["priority"],
                  })
                }
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={ctx.t("تغيير الأولوية", "Change priority")}
              >
                {Object.entries(PRIORITY_CONFIG).map(([key, value]) => (
                  <option key={key} value={key}>
                    {ctx.t(value.ar, value.en)}
                  </option>
                ))}
              </select>
            </div>
          );
        },
      },
      {
        id: "assignee",
        accessorFn: (task) => task.assignee?.name ?? "",
        size: 165,
        minSize: 125,
        header: ctx.t("المسؤول", "Assignee"),
        cell: ({ row }) => {
          const assigneeName =
            row.original.assignee?.name || ctx.users.find((user) => user.id === row.original.assigneeId)?.name;
          const avatarUrl =
            row.original.assignee?.avatarUrl ||
            ctx.users.find((user) => user.id === row.original.assigneeId)?.avatarUrl;
          return (
            <div
              className="group relative inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-raised cursor-pointer max-w-full"
              onClick={(event) => event.stopPropagation()}
            >
              <Avatar src={avatarUrl} name={assigneeName} size={20} />
              <span className="truncate text-[11.5px] font-medium text-ink-soft group-hover:text-ink">
                {assigneeName || ctx.t("غير محدد", "Unassigned")}
              </span>
              <select
                name={`task-assignee-${row.original.id}`}
                value={row.original.assigneeId || ""}
                disabled={!ctx.can("tasks.update")}
                onChange={(event) => ctx.updateTask(row.original.id, { assigneeId: event.target.value || undefined })}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={ctx.t("تعيين مسؤول", "Assign task")}
              >
                <option value="">{ctx.t("غير محدد", "Unassigned")}</option>
                {ctx.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          );
        },
      },
      {
        id: "points",
        accessorKey: "storyPoints",
        size: 88,
        minSize: 72,
        header: ctx.t("النقاط", "Points"),
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return (
            <span className="mono tabular">
              {value !== undefined && value !== null ? fmtNumber(value, ctx.locale) : "—"}
            </span>
          );
        },
      },
      {
        id: "estimate",
        accessorKey: "estimatedHours",
        size: 105,
        minSize: 82,
        header: ctx.t("التقدير", "Estimate"),
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return <span className="mono tabular">{value ? fmtMinutes(value * 60, ctx.locale) : "—"}</span>;
        },
      },
      {
        id: "logged",
        accessorKey: "loggedHours",
        size: 100,
        minSize: 82,
        header: ctx.t("المسجل", "Logged"),
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return <span className="mono tabular text-accent">{value ? fmtMinutes(value * 60, ctx.locale) : "—"}</span>;
        },
      },
      {
        id: "due",
        accessorFn: (task) => (task.dueDate ? new Date(task.dueDate).getTime() : 0),
        size: 125,
        minSize: 100,
        header: ctx.t("الموعد", "Due"),
        cell: ({ row }) => <span>{fmtDate(row.original.dueDate, ctx.locale)}</span>,
      },
    ],
    [ctx, expandedSubtaskTaskIds, subtasksByParentId],
  );

  const topLevelTasks = useMemo(() => ctx.tasks.filter((task) => !task.parentId), [ctx.tasks]);

  // TanStack Table intentionally exposes mutable handler functions; the table state remains explicitly controlled here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: topLevelTasks,
    columns,
    state: { sorting, rowSelection, columnVisibility, columnOrder, columnPinning, columnSizing },
    onSortingChange: (updater) =>
      setTableViewState({ sorting: typeof updater === "function" ? updater(sorting) : updater }),
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: (updater) =>
      setTableViewState({
        columnVisibility: typeof updater === "function" ? updater(columnVisibility) : updater,
      }),
    onColumnOrderChange: (updater) =>
      setTableViewState({ columnOrder: typeof updater === "function" ? updater(columnOrder) : updater }),
    onColumnPinningChange: (updater) =>
      setTableViewState({
        columnPinning: (() => {
          const next = typeof updater === "function" ? updater(columnPinning) : updater;
          return { left: next.left ?? [], right: next.right ?? [] };
        })(),
      }),
    onColumnSizingChange: (updater) =>
      setTableViewState({ columnSizing: typeof updater === "function" ? updater(columnSizing) : updater }),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (task) => task.id,
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
  });

  const rows = table.getRowModel().rows;

  const totals = useMemo(() => {
    const visibleTasks = rows.map((r) => r.original);
    const count = visibleTasks.length;
    const points = visibleTasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0);
    const estimatedHours = visibleTasks.reduce((acc, t) => acc + (t.estimatedHours || 0), 0);
    const loggedHours = visibleTasks.reduce((acc, t) => acc + (t.loggedHours || 0), 0);
    return { count, points, estimatedHours, loggedHours };
  }, [rows]);

  const groupedSections = useMemo(() => {
    if (groupBy === "none") return [];
    if (groupBy === "status") {
      return Object.entries(STATUS_CONFIG).map(([key, config]) => {
        const groupRows = rows.filter((r) => r.original.status === key);
        const groupTasks = groupRows.map((r) => r.original);
        const points = groupTasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0);
        return {
          id: key,
          label: ctx.t(config.ar, config.en),
          dotColor: config.dot,
          borderColor:
            config.tone === "emerald"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : config.tone === "amber"
                ? "border-amber-500/30 bg-amber-500/5"
                : config.tone === "rose"
                  ? "border-rose-500/30 bg-rose-500/5"
                  : "border-indigo-500/30 bg-indigo-500/5",
          accentBar: config.dot,
          rows: groupRows,
          points,
          defaultStatus: key,
          defaultPriority: undefined,
          isCustom: false,
        };
      });
    }
    if (groupBy === "priority") {
      return Object.entries(PRIORITY_CONFIG).map(([key, config]) => {
        const groupRows = rows.filter((r) => r.original.priority === key);
        const groupTasks = groupRows.map((r) => r.original);
        const points = groupTasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0);
        return {
          id: key,
          label: ctx.t(config.ar, config.en),
          dotColor: config.bar,
          borderColor:
            config.tone === "rose"
              ? "border-rose-500/30 bg-rose-500/5"
              : config.tone === "amber"
                ? "border-amber-500/30 bg-amber-500/5"
                : config.tone === "indigo"
                  ? "border-indigo-500/30 bg-indigo-500/5"
                  : "border-slate-500/30 bg-white/5",
          accentBar: config.bar,
          rows: groupRows,
          points,
          defaultStatus: undefined,
          defaultPriority: key as Task["priority"],
          isCustom: false,
        };
      });
    }
    // Custom Groups mode
    return customGroups.map((cg) => {
      const groupRows = rows.filter((r) => cg.taskIds.includes(r.original.id));
      const groupTasks = groupRows.map((r) => r.original);
      const points = groupTasks.reduce((acc, t) => acc + (t.storyPoints || 0), 0);
      const colorBg =
        cg.color === "emerald"
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600"
          : cg.color === "amber"
            ? "border-amber-500/30 bg-amber-500/5 text-amber-600"
            : cg.color === "rose"
              ? "border-rose-500/30 bg-rose-500/5 text-rose-600"
              : cg.color === "violet"
                ? "border-violet-500/30 bg-violet-500/5 text-violet-600"
                : cg.color === "cyan"
                  ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-600"
                  : "border-indigo-500/30 bg-indigo-500/5 text-indigo-600";

      const colorDot =
        cg.color === "emerald"
          ? "bg-emerald-500"
          : cg.color === "amber"
            ? "bg-amber-500"
            : cg.color === "rose"
              ? "bg-rose-500"
              : cg.color === "violet"
                ? "bg-violet-500"
                : cg.color === "cyan"
                  ? "bg-cyan-500"
                  : "bg-indigo-500";

      return {
        id: cg.id,
        label: cg.name,
        dotColor: colorDot,
        borderColor: colorBg,
        accentBar: colorDot,
        rows: groupRows,
        points,
        defaultStatus: undefined,
        defaultPriority: undefined,
        isCustom: true,
      };
    });
  }, [ctx, customGroups, groupBy, rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 49,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.original.id);

  const clipboardTasks = () => {
    const selected = rows.filter((row) => row.getIsSelected()).map((row) => row.original);
    if (selected.length > 0) return selected;
    const focused = rows.find((row) => row.id === focusedRowId)?.original;
    return focused ? [focused] : [];
  };

  const copyTasks = async () => {
    const tasks = clipboardTasks();
    if (tasks.length === 0) {
      ctx.notify(ctx.t("حدد صفاً واحداً على الأقل للنسخ", "Select at least one row to copy"), "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(serializeTasksForClipboard(tasks));
      ctx.notify(ctx.t(`تم نسخ ${fmtNumber(tasks.length, ctx.locale)} مهمة`, `Copied ${tasks.length} task(s)`));
    } catch {
      ctx.notify(ctx.t("تعذر الوصول إلى الحافظة", "Clipboard access was denied"), "error");
    }
  };

  const applyClipboardUpdates = async (updates: TaskClipboardUpdate[]) => {
    if (!ctx.can("tasks.update")) {
      ctx.notify(ctx.t("ليست لديك صلاحية تعديل المهام", "You cannot update tasks"), "error");
      return;
    }
    const selectedTargets = rows.filter((row) => row.getIsSelected());
    const focusedIndex = rows.findIndex((row) => row.id === focusedRowId);
    const targets =
      selectedTargets.length > 0
        ? selectedTargets
        : focusedIndex >= 0
          ? rows.slice(focusedIndex, focusedIndex + updates.length)
          : [];
    if (targets.length === 0) {
      ctx.notify(ctx.t("حدد صف البداية قبل اللصق", "Select a starting row before pasting"), "error");
      return;
    }
    if (updates.length !== 1 && updates.length > targets.length) {
      ctx.notify(
        ctx.t("عدد الصفوف الملصقة أكبر من الصفوف المحددة", "Pasted rows exceed the selected target rows"),
        "error",
      );
      return;
    }
    const unknownAssignee = updates.find(
      (update) => update.assigneeId && !ctx.users.some((user) => user.id === update.assigneeId),
    )?.assigneeId;
    if (unknownAssignee) {
      ctx.notify(ctx.t("يتضمن اللصق مسؤولاً غير موجود", "Paste contains an unknown assignee"), "error");
      return;
    }
    const targetCount = updates.length === 1 ? targets.length : updates.length;
    for (const [index, target] of targets.slice(0, targetCount).entries()) {
      const update = updates.length === 1 ? updates[0]! : updates[index];
      if (update) {
        await ctx.updateTask(target.original.id, {
          ...update,
          progress: update.status === "done" ? 100 : target.original.progress,
        });
      }
    }
    ctx.notify(ctx.t(`تم تحديث ${fmtNumber(targetCount, ctx.locale)} مهمة`, `Updated ${targetCount} task(s)`));
  };

  const pasteTasks = async () => {
    try {
      await applyClipboardUpdates(parseTaskClipboard(await navigator.clipboard.readText()));
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("بيانات اللصق غير صالحة", "Invalid paste data"),
        "error",
      );
    }
  };

  const bulkStatusChange = (status: string) => {
    selectedIds.forEach((id) => ctx.updateTask(id, { status, progress: status === "done" ? 100 : undefined }));
    setRowSelection({});
  };

  return (
    <div
      tabIndex={0}
      className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onCopy={(event) => {
        if (isTextEditingTarget(event.target)) return;
        const tasks = clipboardTasks();
        if (tasks.length === 0) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", serializeTasksForClipboard(tasks));
        ctx.notify(ctx.t(`تم نسخ ${fmtNumber(tasks.length, ctx.locale)} مهمة`, `Copied ${tasks.length} task(s)`));
      }}
      onPaste={(event) => {
        if (isTextEditingTarget(event.target)) return;
        event.preventDefault();
        try {
          void applyClipboardUpdates(parseTaskClipboard(event.clipboardData.getData("text/plain"))).catch((error) =>
            ctx.notify(
              error instanceof Error ? error.message : ctx.t("تعذر تطبيق اللصق", "Paste update failed"),
              "error",
            ),
          );
        } catch (error) {
          ctx.notify(
            error instanceof Error ? error.message : ctx.t("بيانات اللصق غير صالحة", "Invalid paste data"),
            "error",
          );
        }
      }}
      onKeyDown={(event) => {
        if (isTextEditingTarget(event.target)) return;
        const focusedIndex = rows.findIndex((row) => row.id === focusedRowId);
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = Math.min(rows.length - 1, Math.max(0, (focusedIndex < 0 ? 0 : focusedIndex) + direction));
          setFocusedRowId(rows[nextIndex]?.id ?? null);
          virtualizer.scrollToIndex(nextIndex, { align: "auto" });
        }
        if (event.key === " " && focusedIndex >= 0) {
          event.preventDefault();
          rows[focusedIndex]?.toggleSelected();
          setSelectionAnchorId(rows[focusedIndex]?.id ?? null);
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          table.toggleAllRowsSelected(true);
        }
        if (event.key === "Escape") setRowSelection({});
      }}
    >
      <Card className="relative overflow-hidden border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raised/30 px-5 py-3">
          <div>
            <div className="text-[13px] font-semibold text-ink">
              {ctx.t("شبكة المهام المتقدمة", "Advanced task grid")}
            </div>
            <div className="mt-0.5 text-[10.5px] text-ink-faint">
              {fmtNumber(ctx.tasks.length, ctx.locale)} {ctx.t("صف", "rows")} · TanStack Table + Virtualizer
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            <button
              onClick={() => setShowNewGroupModal(true)}
              className="flex items-center gap-1 rounded-xl border border-dashed border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-accent hover:bg-accent/20 transition shadow-xs"
            >
              <IconPlus size={12} />
              <span>{ctx.t("إضافة مجموعة جديدة", "Add Group")}</span>
            </button>
            <div className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 py-1 text-[11.5px]">
              <span className="text-ink-faint font-medium">{ctx.t("تجميع:", "Group:")}</span>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as "none" | "status" | "priority" | "custom")}
                className="bg-transparent font-semibold text-accent focus:outline-none cursor-pointer"
                aria-label={ctx.t("تجميع الجدول", "Group table")}
              >
                <option value="none">{ctx.t("بدون تجميع (مسطح)", "None (Flat)")}</option>
                <option value="status">{ctx.t("حسب الحالة (Status)", "By Status")}</option>
                <option value="priority">{ctx.t("حسب الأولوية (Priority)", "By Priority")}</option>
                <option value="custom">{ctx.t("مجموعات مخصصة (Custom Groups)", "Custom Groups")}</option>
              </select>
            </div>
            <button
              ref={columnsTriggerRef}
              onClick={() => setShowColumns((value) => !value)}
              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-raised transition"
            >
              ⚙️ {ctx.t("إدارة الأعمدة", "Columns")}
            </button>
            <Btn size="sm" variant="ghost" onClick={() => exportTasksCsv(rows.map((row) => row.original))}>
              <IconTrend size={13} />
              {ctx.t("تصدير CSV", "Export CSV")}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => void copyTasks()}>
              {ctx.t("نسخ", "Copy")} <span className="mono text-[10px]">⌘C</span>
            </Btn>
            <Btn size="sm" variant="ghost" disabled={!ctx.can("tasks.update")} onClick={() => void pasteTasks()}>
              {ctx.t("لصق", "Paste")} <span className="mono text-[10px]">⌘V</span>
            </Btn>
            {showColumns && (
              <div
                ref={columnsMenuRef}
                className="absolute end-0 top-10 z-30 w-72 rounded-xl border border-line bg-surface p-2 shadow-xl"
              >
                <div className="mb-1 px-2 text-[10px] font-bold uppercase text-ink-faint">
                  {ctx.t("الإظهار والترتيب والتثبيت", "Visibility, order and pinning")}
                </div>
                {columnOrder
                  .filter((id) => id !== "select")
                  .map((id) => {
                    const column = table.getColumn(id);
                    if (!column) return null;
                    const label = columnLabels[id]?.[ctx.locale === "ar" ? "ar" : "en"] ?? id;
                    return (
                      <div key={id} className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-raised transition">
                        <input
                          name={`toggle-column-${id}`}
                          aria-label={ctx.t(`إظهار ${label}`, `Show ${label}`)}
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                          className="h-4 w-4 accent-accent"
                        />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{label}</span>
                        <button
                          title={ctx.t("تحريك للأعلى", "Move earlier")}
                          onClick={() => setTableViewState({ columnOrder: moveTableColumn(columnOrder, id, -1) })}
                          className="rounded px-1 text-ink-soft hover:bg-surface"
                        >
                          ↑
                        </button>
                        <button
                          title={ctx.t("تحريك للأسفل", "Move later")}
                          onClick={() => setTableViewState({ columnOrder: moveTableColumn(columnOrder, id, 1) })}
                          className="rounded px-1 text-ink-soft hover:bg-surface"
                        >
                          ↓
                        </button>
                        <button
                          title={ctx.t("تثبيت العمود", "Pin column")}
                          onClick={() => column.pin(column.getIsPinned() ? false : "left")}
                          className={cn(
                            "rounded px-1.5 text-[10px]",
                            column.getIsPinned() ? "bg-accent/15 text-accent" : "text-ink-faint",
                          )}
                        >
                          📌
                        </button>
                      </div>
                    );
                  })}
                <button
                  onClick={() => {
                    resetTableViewState();
                  }}
                  className="mt-1 w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-accent hover:bg-accent/10 transition"
                >
                  {ctx.t("إعادة ضبط الأعمدة", "Reset columns")}
                </button>
              </div>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="max-h-[620px] overflow-x-auto overflow-y-auto">
          <div style={{ width: table.getTotalSize(), minWidth: "100%" }}>
            <div className="sticky top-0 z-20 flex border-b border-line bg-raised text-[10.5px] uppercase tracking-wider text-ink-faint">
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <div
                  key={header.id}
                  style={pinnedColumnStyle(header.column)}
                  className={cn(
                    "group/header flex h-10 shrink-0 items-center border-e border-line px-3 font-semibold",
                    header.column.getIsPinned() && "bg-raised",
                  )}
                >
                  <button
                    disabled={!header.column.getCanSort()}
                    onClick={header.column.getToggleSortingHandler()}
                    className="flex min-w-0 flex-1 items-center gap-1 text-start disabled:cursor-default"
                  >
                    <span className="truncate">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </span>
                    {header.column.getIsSorted() === "asc" && <span className="text-accent">↑</span>}
                    {header.column.getIsSorted() === "desc" && <span className="text-accent">↓</span>}
                  </button>
                  {header.column.getCanResize() && (
                    <button
                      aria-label={ctx.t("تغيير حجم العمود", "Resize column")}
                      onDoubleClick={() => header.column.resetSize()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={cn(
                        "absolute inset-y-0 end-0 w-1 cursor-col-resize touch-none bg-transparent hover:bg-accent/50",
                        header.column.getIsResizing() && "bg-accent",
                      )}
                    />
                  )}
                </div>
              ))}
            </div>

            {groupBy === "none" ? (
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index]!;
                  const taskId = row.original.id;
                  const isExpanded = expandedSubtaskTaskIds[taskId];
                  const taskSubtasks = subtasksByParentId.get(taskId) || [];

                  return (
                    <div
                      key={row.id}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      tabIndex={focusedRowId === row.id ? 0 : -1}
                      onFocus={() => setFocusedRowId(row.id)}
                      style={{ transform: `translateY(${virtualRow.start}px)`, position: "absolute", width: "100%" }}
                      className="border-b border-line"
                    >
                      <div
                        onClick={(event) => {
                          setFocusedRowId(row.id);
                          if (event.shiftKey) {
                            event.preventDefault();
                            const anchorIndex = rows.findIndex((candidate) => candidate.id === selectionAnchorId);
                            const currentIndex = rows.findIndex((candidate) => candidate.id === row.id);
                            const start = anchorIndex < 0 ? currentIndex : Math.min(anchorIndex, currentIndex);
                            const end = anchorIndex < 0 ? currentIndex : Math.max(anchorIndex, currentIndex);
                            setRowSelection((current) => {
                              const next = { ...current };
                              for (let index = start; index <= end; index += 1) next[rows[index]!.id] = true;
                              return next;
                            });
                            setSelectionAnchorId(selectionAnchorId ?? row.id);
                            return;
                          }
                          setSelectionAnchorId(row.id);
                          ctx.openTask(row.original);
                        }}
                        className={cn(
                          "flex cursor-pointer text-[12.5px] transition hover:bg-raised/40",
                          row.getIsSelected() && "bg-accent/10",
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div
                            key={cell.id}
                            style={pinnedColumnStyle(cell.column)}
                            className={cn(
                              "flex h-11 shrink-0 items-center overflow-hidden border-e border-line px-3 text-ink-soft",
                              cell.column.getIsPinned() && (row.getIsSelected() ? "bg-accent/10" : "bg-surface"),
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Inline Subtasks List */}
                      {isExpanded && (
                        <div
                          className="border-t border-dashed border-line bg-surface/70 ps-10 pe-4 py-2 space-y-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {taskSubtasks.map((subtask) => (
                            <div
                              key={subtask.id}
                              onClick={() => ctx.openTask(subtask)}
                              className="flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-1 text-[12px] hover:bg-raised/60 transition group cursor-pointer"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={subtask.status === "done"}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    ctx.updateTask(subtask.id, {
                                      status: e.target.checked ? "done" : "todo",
                                      progress: e.target.checked ? 100 : 0,
                                    });
                                  }}
                                  className="h-3.5 w-3.5 rounded accent-accent"
                                />
                                <span className="text-ink-faint text-[10px]">└─</span>
                                <span
                                  className={cn(
                                    "truncate font-medium text-ink",
                                    subtask.status === "done" && "line-through text-ink-faint",
                                  )}
                                >
                                  {subtask.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge tone={STATUS_CONFIG[subtask.status]?.tone} className="text-[10px] py-0 px-1.5">
                                  {ctx.t(STATUS_CONFIG[subtask.status]?.ar, STATUS_CONFIG[subtask.status]?.en)}
                                </Badge>
                              </div>
                            </div>
                          ))}

                          {/* Quick add subtask input */}
                          {ctx.can("tasks.create") && (
                            <div className="flex items-center gap-2 pt-1 ps-6">
                              <IconPlus size={11} className="text-accent shrink-0" />
                              <input
                                type="text"
                                value={inlineSubtaskInput[taskId] || ""}
                                disabled={inlineSubtaskSubmitting[taskId] || false}
                                onChange={(e) =>
                                  setInlineSubtaskInput((prev) => ({ ...prev, [taskId]: e.target.value }))
                                }
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter" && !e.shiftKey && (inlineSubtaskInput[taskId] || "").trim()) {
                                    e.preventDefault();
                                    const val = inlineSubtaskInput[taskId]!.trim();
                                    setInlineSubtaskSubmitting((prev) => ({ ...prev, [taskId]: true }));
                                    await ctx.createTask({
                                      title: val,
                                      parentId: taskId,
                                    });
                                    setInlineSubtaskSubmitting((prev) => ({ ...prev, [taskId]: false }));
                                    setInlineSubtaskInput((prev) => ({ ...prev, [taskId]: "" }));
                                  }
                                }}
                                placeholder={ctx.t(
                                  "+ أضف مهمة فرعية جديدة… (اضغط Enter للحفظ)",
                                  "+ Add new subtask… (Press Enter)",
                                )}
                                className="flex-1 bg-transparent text-[11.5px] text-ink placeholder:text-ink-faint focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {groupedSections.map((group) => {
                  const isCollapsed = collapsedGroups[group.id];
                  const quickTitle = groupQuickAdd[group.id] || "";
                  const isSubmitting = groupQuickAddSubmitting[group.id] || false;

                  return (
                    <div
                      key={group.id}
                      className={cn(
                        "rounded-2xl border transition-all duration-200 overflow-hidden",
                        group.borderColor,
                      )}
                    >
                      {/* Group Header Bar */}
                      <div
                        onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                        className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 bg-surface/90 hover:bg-raised/70 transition select-none"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <IconChevronDown
                            size={14}
                            className={cn(
                              "text-ink-faint transition-transform duration-200",
                              isCollapsed ? "-rotate-90 rtl:rotate-90" : "rotate-0",
                            )}
                          />
                          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${group.dotColor}`} />
                          <span className="text-[13px] font-bold text-ink truncate">{group.label}</span>
                          <span className="mono rounded-md border border-line bg-raised px-1.5 py-0.5 text-[10.5px] font-bold text-ink-soft tabular">
                            {fmtNumber(group.rows.length, ctx.locale)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {group.points > 0 && (
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-faint">
                              <span>{ctx.t("النقاط", "Points")}:</span>
                              <span className="mono font-bold text-amber-600 dark:text-amber-400">
                                {fmtNumber(group.points, ctx.locale)}
                              </span>
                            </div>
                          )}
                          {group.isCustom && (
                            <button
                              type="button"
                              title={ctx.t("حذف المجموعة", "Delete group")}
                              onClick={(e) => {
                                e.stopPropagation();
                                setCustomGroups((prev) => prev.filter((cg) => cg.id !== group.id));
                              }}
                              className="rounded p-1 text-ink-faint hover:text-rose-500 transition"
                            >
                              <IconTrash size={12} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Group Rows Table */}
                      {!isCollapsed && (
                        <div>
                          {group.rows.map((row) => {
                            const taskId = row.original.id;
                            const isSubExpanded = expandedSubtaskTaskIds[taskId];
                            const taskSubtasks = subtasksByParentId.get(taskId) || [];

                            return (
                              <div key={row.id} className="border-t border-line">
                                <div
                                  tabIndex={focusedRowId === row.id ? 0 : -1}
                                  onFocus={() => setFocusedRowId(row.id)}
                                  onClick={() => {
                                    setFocusedRowId(row.id);
                                    ctx.openTask(row.original);
                                  }}
                                  className={cn(
                                    "flex cursor-pointer text-[12.5px] bg-surface transition hover:bg-raised/40",
                                    row.getIsSelected() && "bg-accent/10",
                                  )}
                                >
                                  {row.getVisibleCells().map((cell) => (
                                    <div
                                      key={cell.id}
                                      style={pinnedColumnStyle(cell.column)}
                                      className={cn(
                                        "flex h-11 shrink-0 items-center overflow-hidden border-e border-line px-3 text-ink-soft",
                                        cell.column.getIsPinned() &&
                                          (row.getIsSelected() ? "bg-accent/10" : "bg-surface"),
                                      )}
                                    >
                                      <div className="min-w-0 flex-1">
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                      </div>
                                    </div>
                                  ))}
                                </div>

                                {/* Inline Subtasks List in Group */}
                                {isSubExpanded && (
                                  <div
                                    className="border-t border-dashed border-line bg-surface/70 ps-10 pe-4 py-2 space-y-1.5"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {taskSubtasks.map((subtask) => (
                                      <div
                                        key={subtask.id}
                                        onClick={() => ctx.openTask(subtask)}
                                        className="flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-1 text-[12px] hover:bg-raised/60 transition group cursor-pointer"
                                      >
                                        <div className="flex items-center gap-2 min-w-0">
                                          <input
                                            type="checkbox"
                                            checked={subtask.status === "done"}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              ctx.updateTask(subtask.id, {
                                                status: e.target.checked ? "done" : "todo",
                                                progress: e.target.checked ? 100 : 0,
                                              });
                                            }}
                                            className="h-3.5 w-3.5 rounded accent-accent"
                                          />
                                          <span className="text-ink-faint text-[10px]">└─</span>
                                          <span
                                            className={cn(
                                              "truncate font-medium text-ink",
                                              subtask.status === "done" && "line-through text-ink-faint",
                                            )}
                                          >
                                            {subtask.title}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <Badge
                                            tone={STATUS_CONFIG[subtask.status]?.tone}
                                            className="text-[10px] py-0 px-1.5"
                                          >
                                            {ctx.t(
                                              STATUS_CONFIG[subtask.status]?.ar,
                                              STATUS_CONFIG[subtask.status]?.en,
                                            )}
                                          </Badge>
                                        </div>
                                      </div>
                                    ))}

                                    {/* Quick add subtask input */}
                                    {ctx.can("tasks.create") && (
                                      <div className="flex items-center gap-2 pt-1 ps-6">
                                        <IconPlus size={11} className="text-accent shrink-0" />
                                        <input
                                          type="text"
                                          value={inlineSubtaskInput[taskId] || ""}
                                          disabled={inlineSubtaskSubmitting[taskId] || false}
                                          onChange={(e) =>
                                            setInlineSubtaskInput((prev) => ({ ...prev, [taskId]: e.target.value }))
                                          }
                                          onKeyDown={async (e) => {
                                            if (
                                              e.key === "Enter" &&
                                              !e.shiftKey &&
                                              (inlineSubtaskInput[taskId] || "").trim()
                                            ) {
                                              e.preventDefault();
                                              const val = inlineSubtaskInput[taskId]!.trim();
                                              setInlineSubtaskSubmitting((prev) => ({ ...prev, [taskId]: true }));
                                              await ctx.createTask({
                                                title: val,
                                                parentId: taskId,
                                              });
                                              setInlineSubtaskSubmitting((prev) => ({ ...prev, [taskId]: false }));
                                              setInlineSubtaskInput((prev) => ({ ...prev, [taskId]: "" }));
                                            }
                                          }}
                                          placeholder={ctx.t(
                                            "+ أضف مهمة فرعية جديدة… (اضغط Enter للحفظ)",
                                            "+ Add new subtask… (Press Enter)",
                                          )}
                                          className="flex-1 bg-transparent text-[11.5px] text-ink placeholder:text-ink-faint focus:outline-none"
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {group.rows.length === 0 && (
                            <div className="py-4 text-center text-[11.5px] text-ink-faint">
                              {ctx.t("لا توجد مهام في هذه المجموعة", "No tasks in this group")}
                            </div>
                          )}

                          {/* Quick Add Row inside this group */}
                          {ctx.can("tasks.create") && (
                            <div
                              className="flex items-center gap-2 border-t border-line bg-surface/50 px-4 py-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <IconPlus size={13} className="shrink-0 text-accent" />
                              <input
                                type="text"
                                value={quickTitle}
                                disabled={isSubmitting}
                                onChange={(e) => setGroupQuickAdd((prev) => ({ ...prev, [group.id]: e.target.value }))}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter" && !e.shiftKey && quickTitle.trim()) {
                                    e.preventDefault();
                                    setGroupQuickAddSubmitting((prev) => ({ ...prev, [group.id]: true }));
                                    const success = await ctx.createTask({
                                      title: quickTitle.trim(),
                                      status: group.defaultStatus,
                                      priority: group.defaultPriority,
                                    });
                                    setGroupQuickAddSubmitting((prev) => ({ ...prev, [group.id]: false }));
                                    if (success) {
                                      setGroupQuickAdd((prev) => ({ ...prev, [group.id]: "" }));
                                    }
                                  }
                                }}
                                placeholder={ctx.t(
                                  `+ إضافة مهمة إلى (${group.label})… (اضغط Enter للحفظ)`,
                                  `+ Add task to (${group.label})… (Press Enter)`,
                                )}
                                className="flex-1 bg-transparent text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Add Group CTA at bottom of groups */}
                <button
                  type="button"
                  onClick={() => setShowNewGroupModal(true)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line py-3 text-[12px] font-semibold text-ink-soft hover:border-accent hover:text-accent hover:bg-raised/40 transition"
                >
                  <IconPlus size={14} />
                  <span>{ctx.t("إضافة مجموعة / جدول فرعي جديد", "Add New Group / Sub-table")}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {ctx.tasks.length === 0 && <Empty icon={<IconSearch size={22} />} title={ctx.t("لا توجد بيانات", "No data")} />}

        {/* Quick Add Row */}
        {ctx.can("tasks.create") && (
          <div className="flex items-center gap-2 border-t border-line bg-surface/50 px-4 py-2.5">
            <IconPlus size={14} className="shrink-0 text-accent" />
            <input
              type="text"
              value={newRowTitle}
              disabled={newRowSubmitting}
              onChange={(e) => setNewRowTitle(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !e.shiftKey && newRowTitle.trim()) {
                  e.preventDefault();
                  setNewRowSubmitting(true);
                  const success = await ctx.createTask({ title: newRowTitle.trim() });
                  setNewRowSubmitting(false);
                  if (success) setNewRowTitle("");
                }
              }}
              placeholder={ctx.t("إضافة مهمة جديدة في الجدول… (اضغط Enter للحفظ)", "Add a new task row… (Press Enter)")}
              className="flex-1 bg-transparent text-[12.5px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            {newRowTitle.trim() && (
              <Btn
                size="sm"
                disabled={newRowSubmitting}
                onClick={async () => {
                  if (!newRowTitle.trim()) return;
                  setNewRowSubmitting(true);
                  const success = await ctx.createTask({ title: newRowTitle.trim() });
                  setNewRowSubmitting(false);
                  if (success) setNewRowTitle("");
                }}
              >
                {newRowSubmitting ? ctx.t("جارٍ الإضافة…", "Adding…") : ctx.t("إضافة", "Add")}
              </Btn>
            )}
          </div>
        )}

        {/* Summary Footer */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised/70 px-4 py-2.5 text-[11.5px] font-medium text-ink-soft">
            <div className="flex items-center gap-4">
              <span className="font-semibold text-ink">
                {ctx.t("إجمالي المهام", "Total Tasks")}:{" "}
                <span className="mono font-bold text-accent">{fmtNumber(totals.count, ctx.locale)}</span>
              </span>
              {totals.points > 0 && (
                <span>
                  {ctx.t("مجموع النقاط", "Total Points")}:{" "}
                  <span className="mono font-bold text-amber-600 dark:text-amber-400">
                    {fmtNumber(totals.points, ctx.locale)}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {totals.estimatedHours > 0 && (
                <span>
                  {ctx.t("إجمالي التقدير", "Total Estimate")}:{" "}
                  <span className="mono font-bold">{fmtMinutes(totals.estimatedHours * 60, ctx.locale)}</span>
                </span>
              )}
              {totals.loggedHours > 0 && (
                <span>
                  {ctx.t("إجمالي المسجل", "Total Logged")}:{" "}
                  <span className="mono font-bold text-accent">{fmtMinutes(totals.loggedHours * 60, ctx.locale)}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {ctx.taskPagination.mode === "page" && ctx.taskPagination.total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[11px] text-ink-faint">
            <span>
              {ctx.t("المحمّل", "Loaded")}: {fmtNumber(ctx.tasks.length, ctx.locale)} /{" "}
              {fmtNumber(ctx.taskPagination.total, ctx.locale)}
            </span>
            {ctx.taskPagination.hasMore && (
              <button
                disabled={ctx.taskPagination.loading}
                onClick={() => void ctx.taskPagination.loadMore()}
                className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
              >
                {ctx.taskPagination.loading
                  ? ctx.t("جارٍ التحميل…", "Loading…")
                  : ctx.t("تحميل 100 أخرى", "Load 100 more")}
              </button>
            )}
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="sticky bottom-4 z-30 mx-auto mt-4 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised px-5 py-3 text-ink shadow-2xl backdrop-blur-md">
            <span className="text-[13px] font-bold text-accent">
              {fmtNumber(selectedIds.length, ctx.locale)} {ctx.t("مهمة محددة", "selected")}
            </span>
            <select
              name="bulk-status-select"
              defaultValue=""
              onChange={(event) => event.target.value && bulkStatusChange(event.target.value)}
              className={`${selectCls} h-8 w-auto`}
            >
              <option value="">{ctx.t("تغيير الحالة...", "Change status...")}</option>
              {Object.entries(STATUS_CONFIG).map(([key, value]) => (
                <option key={key} value={key}>
                  {ctx.t(value.ar, value.en)}
                </option>
              ))}
            </select>
            <Btn
              size="sm"
              variant="danger"
              onClick={async () => {
                const confirmed = await confirmAction({
                  title: ctx.t("حذف المهام المحددة", "Delete selected tasks"),
                  message: ctx.t(
                    "هل أنت متأكد من حذف المهام المحددة؟ لا يمكن التراجع عن هذا الإجراء.",
                    "Are you sure you want to delete the selected tasks?",
                  ),
                  tone: "danger",
                });
                if (!confirmed) return;
                await deleteTasks(selectedIds);
                setRowSelection({});
              }}
            >
              {ctx.t("حذف جماعي", "Delete")}
            </Btn>
            <Btn size="sm" variant="outline" onClick={() => setRowSelection({})}>
              {ctx.t("إلغاء", "Cancel")}
            </Btn>
          </div>
        )}
      </Card>

      {showNewGroupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in"
          onClick={() => setShowNewGroupModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <IconFolder size={18} className="text-accent" />
                <h3 className="text-base font-bold text-ink">
                  {ctx.t("إنشاء مجموعة / جدول فرعي جديد", "Create New Group / Sub-table")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNewGroupModal(false)}
                className="rounded-lg p-1 text-ink-faint hover:bg-raised hover:text-ink transition"
              >
                <IconX size={16} />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-[12px] font-semibold text-ink-soft mb-1.5">
                  {ctx.t("اسم المجموعة", "Group Name")}
                </label>
                <input
                  type="text"
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newGroupName.trim()) {
                      e.preventDefault();
                      const newId = `grp-${Date.now()}`;
                      setCustomGroups((prev) => [
                        ...prev,
                        { id: newId, name: newGroupName.trim(), color: newGroupColor, taskIds: [] },
                      ]);
                      setGroupBy("custom");
                      setNewGroupName("");
                      setShowNewGroupModal(false);
                    }
                  }}
                  placeholder={ctx.t("مثال: المرحلة الأولى، مهام التصميم…", "e.g. Phase 1, Design Tasks…")}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-ink-soft mb-2">
                  {ctx.t("لون المجموعة", "Group Color")}
                </label>
                <div className="flex items-center gap-3">
                  {[
                    { id: "indigo", bg: "bg-indigo-500", label: "Indigo" },
                    { id: "emerald", bg: "bg-emerald-500", label: "Emerald" },
                    { id: "amber", bg: "bg-amber-500", label: "Amber" },
                    { id: "rose", bg: "bg-rose-500", label: "Rose" },
                    { id: "violet", bg: "bg-violet-500", label: "Violet" },
                    { id: "cyan", bg: "bg-cyan-500", label: "Cyan" },
                  ].map((color) => (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => setNewGroupColor(color.id)}
                      className={cn(
                        "h-7 w-7 rounded-full transition transform hover:scale-110",
                        color.bg,
                        newGroupColor === color.id && "ring-2 ring-accent ring-offset-2 ring-offset-surface scale-110",
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2 border-t border-line pt-4">
              <Btn size="sm" variant="ghost" onClick={() => setShowNewGroupModal(false)}>
                {ctx.t("إلغاء", "Cancel")}
              </Btn>
              <Btn
                size="sm"
                disabled={!newGroupName.trim()}
                onClick={() => {
                  if (!newGroupName.trim()) return;
                  const newId = `grp-${Date.now()}`;
                  setCustomGroups((prev) => [
                    ...prev,
                    { id: newId, name: newGroupName.trim(), color: newGroupColor, taskIds: [] },
                  ]);
                  setGroupBy("custom");
                  setNewGroupName("");
                  setShowNewGroupModal(false);
                }}
              >
                {ctx.t("إنشاء المجموعة", "Create Group")}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
