"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Project, Task } from "@/lib/types";
import { STATUS_ORDER } from "@/lib/types";
import { getTaskPage, getTasks, type TaskPageFilters } from "@/features/workspace/api";
import type { SavedViewTableConfiguration } from "@/lib/types";

const BOARD_PAGE_SIZE = 50;
const TABLE_PAGE_SIZE = 100;
const fullCollectionViews = new Set(["list", "calendar", "timeline", "workload", "mywork", "dashboard"]);
const tableSortFields: Record<string, TaskPageFilters["sortBy"]> = {
  title: "title",
  status: "status",
  priority: "priority",
  assignee: "assigneeId",
  points: "storyPoints",
  estimate: "estimatedHours",
  logged: "loggedHours",
  due: "dueDate",
};

type PageMarker = { nextCursor: string | null; total: number };

export type TaskPaginationState = {
  mode: "page" | "board" | "full";
  loading: boolean;
  total: number;
  hasMore: boolean;
  statusTotals: Record<string, number>;
  statusHasMore: Record<string, boolean>;
  loadMore: () => Promise<void>;
  loadMoreStatus: (status: string) => Promise<void>;
};

function tableSort(sorting: SavedViewTableConfiguration["sorting"]): Pick<TaskPageFilters, "sortBy" | "sortDirection"> {
  const first = sorting?.[0];
  const sortBy = first ? tableSortFields[first.id] : undefined;
  return {
    sortBy: sortBy ?? "createdAt",
    sortDirection: first?.desc ? "desc" : "asc",
  };
}

function mergeTasks(current: Task[], incoming: Task[]) {
  const records = new Map(current.map((task) => [task.id, task]));
  for (const task of incoming) records.set(task.id, task);
  return [...records.values()];
}

export function useTaskPagination(input: {
  activeProject: Project | null;
  activeView: string;
  taskFilter: Record<string, string | undefined>;
  tableState: SavedViewTableConfiguration;
  setTasks: Dispatch<SetStateAction<Task[]>>;
  notify: (message: string, kind?: "success" | "error") => void;
  t: (arabic: string, english: string) => string;
}) {
  const { activeProject, activeView, taskFilter, tableState, setTasks, notify, t } = input;
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<TaskPaginationState["mode"]>("page");
  const [page, setPage] = useState<PageMarker>({ nextCursor: null, total: 0 });
  const [boardPages, setBoardPages] = useState<Record<string, PageMarker>>({});
  const requestVersion = useRef(0);
  const searchFilter = taskFilter.search;
  const statusFilter = taskFilter.status;
  const priorityFilter = taskFilter.priority;
  const assigneeFilter = taskFilter.assignee;
  const commonFilters = useMemo(
    () => ({
      search: searchFilter || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      assigneeId: assigneeFilter || undefined,
    }),
    [assigneeFilter, priorityFilter, searchFilter, statusFilter],
  );

  const load = useCallback(async () => {
    const project = activeProject;
    if (!project) {
      setTasks([]);
      setPage({ nextCursor: null, total: 0 });
      setBoardPages({});
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      if (activeView === "board") {
        setMode("board");
        const requestedStatuses = statusFilter ? [statusFilter] : [...STATUS_ORDER];
        const responses = await Promise.all(
          requestedStatuses.map(async (status) => ({
            status,
            page: await getTaskPage(project, {
              ...commonFilters,
              status,
              limit: BOARD_PAGE_SIZE,
              sortBy: "order",
              sortDirection: "asc",
            }),
          })),
        );
        if (version !== requestVersion.current) return;
        setTasks(responses.flatMap((response) => response.page.items));
        setBoardPages(
          Object.fromEntries(
            responses.map(({ status, page }) => [status, { nextCursor: page.nextCursor, total: page.total }]),
          ),
        );
        setPage({
          nextCursor: null,
          total: responses.reduce((total, response) => total + response.page.total, 0),
        });
        return;
      }
      if (activeView === "table") {
        setMode("page");
        const response = await getTaskPage(project, {
          ...commonFilters,
          ...tableSort(tableState.sorting),
          limit: TABLE_PAGE_SIZE,
        });
        if (version !== requestVersion.current) return;
        setTasks(response.items);
        setPage({ nextCursor: response.nextCursor, total: response.total });
        setBoardPages({});
        return;
      }
      if (fullCollectionViews.has(activeView)) {
        setMode("full");
        const records = await getTasks(project);
        if (version !== requestVersion.current) return;
        setTasks(records);
        setPage({ nextCursor: null, total: records.length });
        setBoardPages({});
      }
    } catch {
      if (version === requestVersion.current) {
        notify(t("تعذر تحميل مهام المشروع", "Could not load project tasks"), "error");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [activeProject, activeView, commonFilters, notify, setTasks, t, tableState.sorting, statusFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), searchFilter ? 250 : 0);
    return () => window.clearTimeout(timeout);
  }, [load, searchFilter]);

  const loadMore = useCallback(async () => {
    if (!activeProject || mode !== "page" || !page.nextCursor || loading) return;
    setLoading(true);
    try {
      const response = await getTaskPage(activeProject, {
        ...commonFilters,
        ...tableSort(tableState.sorting),
        limit: TABLE_PAGE_SIZE,
        cursor: page.nextCursor,
      });
      setTasks((current) => mergeTasks(current, response.items));
      setPage({ nextCursor: response.nextCursor, total: response.total });
    } catch {
      notify(t("تعذر تحميل الصفحة التالية", "Could not load the next page"), "error");
    } finally {
      setLoading(false);
    }
  }, [activeProject, commonFilters, loading, mode, notify, page.nextCursor, setTasks, t, tableState.sorting]);

  const loadMoreStatus = useCallback(
    async (status: string) => {
      const marker = boardPages[status];
      if (!activeProject || mode !== "board" || !marker?.nextCursor || loading) return;
      setLoading(true);
      try {
        const response = await getTaskPage(activeProject, {
          ...commonFilters,
          status,
          limit: BOARD_PAGE_SIZE,
          sortBy: "order",
          sortDirection: "asc",
          cursor: marker.nextCursor,
        });
        setTasks((current) => mergeTasks(current, response.items));
        setBoardPages((current) => ({
          ...current,
          [status]: { nextCursor: response.nextCursor, total: response.total },
        }));
      } catch {
        notify(t("تعذر تحميل المزيد من العمود", "Could not load more from this column"), "error");
      } finally {
        setLoading(false);
      }
    },
    [activeProject, boardPages, commonFilters, loading, mode, notify, setTasks, t],
  );

  return {
    refresh: load,
    pagination: {
      mode,
      loading,
      total: page.total,
      hasMore: Boolean(page.nextCursor),
      statusTotals: Object.fromEntries(Object.entries(boardPages).map(([status, marker]) => [status, marker.total])),
      statusHasMore: Object.fromEntries(
        Object.entries(boardPages).map(([status, marker]) => [status, Boolean(marker.nextCursor)]),
      ),
      loadMore,
      loadMoreStatus,
    } satisfies TaskPaginationState,
  };
}
