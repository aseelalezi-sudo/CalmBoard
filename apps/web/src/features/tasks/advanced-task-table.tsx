"use client";

import { useMemo, useRef, useState } from "react";
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
import { Avatar, Badge, Btn, Card, Empty } from "@/components/ui";
import { IconSearch, IconTrend } from "@/components/icons";
import type { Task, ViewCtx } from "@/lib/types";
import { fmtDate, PRIORITY_CONFIG, STATUS_CONFIG } from "@/lib/types";
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
            name="auto-field-6jlmr6z"
            aria-label={ctx.t("تحديد جميع المهام", "Select all tasks")}
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            ref={(node) => {
              if (node) node.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            className="h-4 w-4 rounded accent-indigo-600 dark:accent-cyan-400"
          />
        ),
        cell: ({ row }) => (
          <input
            name="auto-field-vyol84t"
            aria-label={ctx.t(`تحديد ${row.original.title}`, `Select ${row.original.title}`)}
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(event) => event.stopPropagation()}
            className="h-4 w-4 rounded accent-indigo-600 dark:accent-cyan-400"
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
          return (
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${priority?.bar}`} />
              <span className="mono shrink-0 rounded bg-slate-100 px-1 py-0.5 text-[10px] text-slate-500 dark:bg-white/[0.05] dark:text-zinc-400">
                {row.original.serial}
              </span>
              <span className="truncate font-semibold text-slate-800 dark:text-zinc-200">{row.original.title}</span>
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
        cell: ({ row }) => (
          <select
            name="auto-field-7p8f54b"
            value={row.original.status}
            disabled={!ctx.can("tasks.update")}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              ctx.updateTask(row.original.id, {
                status: event.target.value,
                progress: event.target.value === "done" ? 100 : undefined,
              })
            }
            className="h-7 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none disabled:opacity-60 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {Object.entries(STATUS_CONFIG).map(([key, value]) => (
              <option key={key} value={key}>
                {ctx.t(value.ar, value.en)}
              </option>
            ))}
          </select>
        ),
      },
      {
        id: "priority",
        accessorFn: (task) => PRIORITY_CONFIG[task.priority]?.weight ?? 0,
        size: 120,
        minSize: 95,
        header: ctx.t("الأولوية", "Priority"),
        cell: ({ row }) => {
          const priority = PRIORITY_CONFIG[row.original.priority];
          return <Badge tone={priority?.tone}>{priority?.[ctx.locale === "ar" ? "ar" : "en"]}</Badge>;
        },
      },
      {
        id: "assignee",
        accessorFn: (task) => task.assignee?.name ?? "",
        size: 165,
        minSize: 125,
        header: ctx.t("المسؤول", "Assignee"),
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
            <Avatar
              src={
                row.original.assignee?.avatarUrl ||
                ctx.users.find((user) => user.id === row.original.assigneeId)?.avatarUrl
              }
              name={row.original.assignee?.name}
              size={20}
            />
            <select
              name="auto-field-rx8b35p"
              value={row.original.assigneeId || ""}
              disabled={!ctx.can("tasks.update")}
              onChange={(event) => ctx.updateTask(row.original.id, { assigneeId: event.target.value || undefined })}
              className="h-7 min-w-0 flex-1 truncate rounded-lg border border-transparent bg-transparent px-1 text-[11.5px] text-slate-700 outline-none hover:border-slate-200 disabled:opacity-60 dark:text-zinc-300 dark:hover:border-white/10 dark:[&>option]:bg-zinc-900"
            >
              <option value="">{ctx.t("غير محدد", "Unassigned")}</option>
              {ctx.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
        ),
      },
      {
        id: "points",
        accessorKey: "storyPoints",
        size: 88,
        minSize: 72,
        header: ctx.t("النقاط", "Points"),
        cell: ({ getValue }) => <span className="mono tabular">{String(getValue<number>() ?? "—")}</span>,
      },
      {
        id: "estimate",
        accessorKey: "estimatedHours",
        size: 105,
        minSize: 82,
        header: ctx.t("التقدير", "Estimate"),
        cell: ({ getValue }) => {
          const value = getValue<number>();
          return <span className="mono tabular">{value ? `${value}h` : "—"}</span>;
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
          return <span className="mono tabular text-indigo-600 dark:text-violet-300">{value ? `${value}h` : "—"}</span>;
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
    [ctx],
  );

  // TanStack Table intentionally exposes mutable handler functions; the table state remains explicitly controlled here.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: ctx.tasks,
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
      ctx.notify(ctx.t(`تم نسخ ${tasks.length} مهمة`, `Copied ${tasks.length} task(s)`));
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
    ctx.notify(ctx.t(`تم تحديث ${targetCount} مهمة`, `Updated ${targetCount} task(s)`));
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
      className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      onCopy={(event) => {
        if (isTextEditingTarget(event.target)) return;
        const tasks = clipboardTasks();
        if (tasks.length === 0) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", serializeTasksForClipboard(tasks));
        ctx.notify(ctx.t(`تم نسخ ${tasks.length} مهمة`, `Copied ${tasks.length} task(s)`));
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
      <Card className="relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-white/50 px-5 py-3 dark:border-white/[0.06] dark:bg-transparent">
          <div>
            <div className="text-[13px] font-semibold text-slate-900 dark:text-white">
              {ctx.t("شبكة المهام المتقدمة", "Advanced task grid")}
            </div>
            <div className="mt-0.5 text-[10.5px] text-slate-500 dark:text-zinc-500">
              {ctx.tasks.length.toLocaleString(ctx.locale === "ar" ? "ar-SA" : "en-US")} {ctx.t("صف", "rows")} ·
              TanStack Table + Virtualizer
            </div>
          </div>
          <div className="relative flex items-center gap-2">
            <button
              onClick={() => setShowColumns((value) => !value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
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
              <div className="absolute end-0 top-10 z-30 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-zinc-900">
                <div className="mb-1 px-2 text-[10px] font-bold uppercase text-slate-400">
                  {ctx.t("الإظهار والترتيب والتثبيت", "Visibility, order and pinning")}
                </div>
                {columnOrder
                  .filter((id) => id !== "select")
                  .map((id) => {
                    const column = table.getColumn(id);
                    if (!column) return null;
                    const label = columnLabels[id]?.[ctx.locale === "ar" ? "ar" : "en"] ?? id;
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-100 dark:hover:bg-white/5"
                      >
                        <input
                          name="auto-field-zfix5ml"
                          aria-label={ctx.t(`إظهار ${label}`, `Show ${label}`)}
                          type="checkbox"
                          checked={column.getIsVisible()}
                          onChange={column.getToggleVisibilityHandler()}
                          className="h-4 w-4 accent-indigo-600"
                        />
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-slate-700 dark:text-zinc-300">
                          {label}
                        </span>
                        <button
                          title={ctx.t("تحريك للأعلى", "Move earlier")}
                          onClick={() => setTableViewState({ columnOrder: moveTableColumn(columnOrder, id, -1) })}
                          className="rounded px-1 text-slate-500 hover:bg-white dark:hover:bg-white/10"
                        >
                          ↑
                        </button>
                        <button
                          title={ctx.t("تحريك للأسفل", "Move later")}
                          onClick={() => setTableViewState({ columnOrder: moveTableColumn(columnOrder, id, 1) })}
                          className="rounded px-1 text-slate-500 hover:bg-white dark:hover:bg-white/10"
                        >
                          ↓
                        </button>
                        <button
                          title={ctx.t("تثبيت العمود", "Pin column")}
                          onClick={() => column.pin(column.getIsPinned() ? false : "left")}
                          className={cn(
                            "rounded px-1.5 text-[10px]",
                            column.getIsPinned()
                              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300"
                              : "text-slate-400",
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
                  className="mt-1 w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                >
                  {ctx.t("إعادة ضبط الأعمدة", "Reset columns")}
                </button>
              </div>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="max-h-[620px] overflow-auto">
          <div style={{ width: table.getTotalSize(), minWidth: "100%" }}>
            <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-50 text-[10.5px] uppercase tracking-wider text-slate-500 dark:border-white/[0.08] dark:bg-zinc-950 dark:text-zinc-500">
              {table.getHeaderGroups()[0]?.headers.map((header) => (
                <div
                  key={header.id}
                  style={pinnedColumnStyle(header.column)}
                  className={cn(
                    "group/header flex h-10 shrink-0 items-center border-e border-slate-200 px-3 font-semibold dark:border-white/[0.06]",
                    header.column.getIsPinned() && "bg-slate-100 dark:bg-zinc-950",
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
                    {header.column.getIsSorted() === "asc" && <span className="text-indigo-600">↑</span>}
                    {header.column.getIsSorted() === "desc" && <span className="text-indigo-600">↓</span>}
                  </button>
                  {header.column.getCanResize() && (
                    <button
                      aria-label={ctx.t("تغيير حجم العمود", "Resize column")}
                      onDoubleClick={() => header.column.resetSize()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={cn(
                        "absolute inset-y-0 end-0 w-1 cursor-col-resize touch-none bg-transparent hover:bg-indigo-400",
                        header.column.getIsResizing() && "bg-indigo-500",
                      )}
                    />
                  )}
                </div>
              ))}
            </div>

            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                return (
                  <div
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    tabIndex={focusedRowId === row.id ? 0 : -1}
                    onFocus={() => setFocusedRowId(row.id)}
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
                    style={{ transform: `translateY(${virtualRow.start}px)`, position: "absolute", width: "100%" }}
                    className={cn(
                      "flex cursor-pointer border-b border-slate-100 text-[12.5px] transition hover:bg-slate-50 dark:border-white/[0.04] dark:hover:bg-white/[0.03]",
                      row.getIsSelected() && "bg-indigo-50 dark:bg-indigo-500/[0.08]",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        style={pinnedColumnStyle(cell.column)}
                        className={cn(
                          "flex h-12 shrink-0 items-center overflow-hidden border-e border-slate-100 px-3 text-slate-600 dark:border-white/[0.04] dark:text-zinc-400",
                          cell.column.getIsPinned() &&
                            (row.getIsSelected() ? "bg-indigo-50 dark:bg-[#17172b]" : "bg-white dark:bg-[#101018]"),
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {ctx.tasks.length === 0 && <Empty icon={<IconSearch size={22} />} title={ctx.t("لا توجد بيانات", "No data")} />}

        {ctx.taskPagination.mode === "page" && ctx.taskPagination.total > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500 dark:border-white/[0.06] dark:text-zinc-500">
            <span>
              {ctx.t("المحمّل", "Loaded")}: {ctx.tasks.length.toLocaleString()} /{" "}
              {ctx.taskPagination.total.toLocaleString()}
            </span>
            {ctx.taskPagination.hasMore && (
              <button
                disabled={ctx.taskPagination.loading}
                onClick={() => void ctx.taskPagination.loadMore()}
                className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
              >
                {ctx.taskPagination.loading
                  ? ctx.t("جارٍ التحميل…", "Loading…")
                  : ctx.t("تحميل 100 أخرى", "Load 100 more")}
              </button>
            )}
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit flex-wrap items-center gap-3 rounded-2xl border border-white/20 bg-slate-900 px-5 py-3 text-white shadow-2xl dark:bg-zinc-900/95">
            <span className="text-[13px] font-bold text-indigo-300">
              {selectedIds.length} {ctx.t("مهمة محددة", "selected")}
            </span>
            <select
              name="auto-field-y046rsl"
              defaultValue=""
              onChange={(event) => event.target.value && bulkStatusChange(event.target.value)}
              className="h-8 rounded-lg bg-white/10 px-2.5 text-[12px] text-white outline-none [&>option]:bg-zinc-900"
            >
              <option value="">{ctx.t("تغيير الحالة...", "Change status...")}</option>
              {Object.entries(STATUS_CONFIG).map(([key, value]) => (
                <option key={key} value={key}>
                  {ctx.t(value.ar, value.en)}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!confirm(ctx.t("هل أنت متأكد من الحذف؟", "Are you sure?"))) return;
                void deleteTasks(selectedIds).then(() => setRowSelection({}));
              }}
              className="h-8 rounded-lg bg-rose-500/20 px-3 text-[12px] font-semibold text-rose-300 hover:bg-rose-500/30"
            >
              {ctx.t("حذف جماعي", "Delete")}
            </button>
            <button
              onClick={() => setRowSelection({})}
              className="h-8 rounded-lg bg-white/10 px-2.5 text-[12px] text-zinc-300 hover:bg-white/20"
            >
              {ctx.t("إلغاء", "Cancel")}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
