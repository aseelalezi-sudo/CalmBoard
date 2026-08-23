"use client";

import { create } from "zustand";
import type {
  SavedViewBoardConfiguration,
  SavedViewCalendarConfiguration,
  SavedViewConfiguration,
  SavedViewCustomGroup,
  SavedViewListConfiguration,
  SavedViewTableConfiguration,
  SavedViewTimelineConfiguration,
} from "@/lib/types";
import { normalizeTableColumnOrder, TASK_TABLE_COLUMN_ORDER } from "@/features/tasks/task-table-state";

const columnIds = new Set<string>(TASK_TABLE_COLUMN_ORDER);
const allowedCustomGroupColors = new Set(["indigo", "emerald", "amber", "rose", "violet", "cyan", "slate"]);

export const DEFAULT_TASK_TABLE_STATE: SavedViewTableConfiguration = {
  sorting: [{ id: "title", desc: false }],
  columnVisibility: {},
  columnOrder: [...TASK_TABLE_COLUMN_ORDER],
  columnPinning: { left: ["select", "title"], right: [] },
  columnSizing: {},
  groupBy: "none",
  collapsedGroups: {},
  customGroups: [
    {
      id: "grp-1",
      name: "Phase 1",
      color: "indigo",
      taskIds: [],
    },
    {
      id: "grp-2",
      name: "Backlog",
      color: "emerald",
      taskIds: [],
    },
  ],
};

export const DEFAULT_TASK_BOARD_STATE: SavedViewBoardConfiguration = {
  groupBy: "status",
  collapsedColumns: {},
};

export const DEFAULT_TASK_CALENDAR_STATE: SavedViewCalendarConfiguration = {
  mode: "month",
};

export const DEFAULT_TASK_TIMELINE_STATE: SavedViewTimelineConfiguration = {
  zoom: "weeks",
  showCritical: false,
};

export const DEFAULT_TASK_LIST_STATE: SavedViewListConfiguration = {
  sorting: [{ id: "title", desc: false }],
  groupBy: "none",
};

function knownColumns(values: string[] | undefined) {
  return [...new Set((values ?? []).filter((value) => columnIds.has(value)))];
}

function normalizeCustomGroups(groups?: SavedViewCustomGroup[]): SavedViewCustomGroup[] {
  if (!Array.isArray(groups)) return DEFAULT_TASK_TABLE_STATE.customGroups;
  return groups
    .filter((g) => g && typeof g.id === "string" && typeof g.name === "string")
    .map((g) => ({
      id: g.id,
      name: String(g.name).slice(0, 100),
      color: allowedCustomGroupColors.has(g.color) ? g.color : "indigo",
      taskIds: Array.isArray(g.taskIds) ? [...new Set(g.taskIds.filter((id) => typeof id === "string"))] : [],
    }))
    .slice(0, 50);
}

export function normalizeTaskTableConfiguration(
  configuration?: Partial<SavedViewTableConfiguration>,
): SavedViewTableConfiguration {
  const visibility = Object.fromEntries(
    Object.entries(configuration?.columnVisibility ?? {}).filter(
      ([id, visible]) => columnIds.has(id) && typeof visible === "boolean",
    ),
  );
  const sizing = Object.fromEntries(
    Object.entries(configuration?.columnSizing ?? {}).filter(
      ([id, size]) => columnIds.has(id) && Number.isFinite(size) && size >= 40 && size <= 1000,
    ),
  );
  const collapsed = Object.fromEntries(
    Object.entries(configuration?.collapsedGroups ?? {}).filter(
      ([id, val]) => typeof id === "string" && typeof val === "boolean",
    ),
  );
  const validGroupBy = ["none", "status", "priority", "custom"].includes(configuration?.groupBy as string)
    ? (configuration?.groupBy as SavedViewTableConfiguration["groupBy"])
    : DEFAULT_TASK_TABLE_STATE.groupBy;

  return {
    sorting: (configuration?.sorting ?? DEFAULT_TASK_TABLE_STATE.sorting)
      .filter((sort) => columnIds.has(sort.id) && typeof sort.desc === "boolean")
      .slice(0, 3),
    columnVisibility: visibility,
    columnOrder: normalizeTableColumnOrder(knownColumns(configuration?.columnOrder)),
    columnPinning: {
      left: knownColumns(configuration?.columnPinning?.left),
      right: knownColumns(configuration?.columnPinning?.right),
    },
    columnSizing: sizing,
    groupBy: validGroupBy,
    collapsedGroups: collapsed,
    customGroups: configuration?.customGroups
      ? normalizeCustomGroups(configuration.customGroups)
      : DEFAULT_TASK_TABLE_STATE.customGroups,
  };
}

export function normalizeTaskBoardConfiguration(
  configuration?: Partial<SavedViewBoardConfiguration>,
): SavedViewBoardConfiguration {
  const validGroupBy = ["status", "priority", "assignee"].includes(configuration?.groupBy as string)
    ? (configuration?.groupBy as SavedViewBoardConfiguration["groupBy"])
    : DEFAULT_TASK_BOARD_STATE.groupBy;
  const collapsed = Object.fromEntries(
    Object.entries(configuration?.collapsedColumns ?? {}).filter(
      ([id, val]) => typeof id === "string" && typeof val === "boolean",
    ),
  );
  return {
    groupBy: validGroupBy,
    collapsedColumns: collapsed,
  };
}

export function normalizeTaskCalendarConfiguration(
  configuration?: Partial<SavedViewCalendarConfiguration>,
): SavedViewCalendarConfiguration {
  const mode = ["month", "week", "day"].includes(configuration?.mode as string)
    ? (configuration?.mode as SavedViewCalendarConfiguration["mode"])
    : DEFAULT_TASK_CALENDAR_STATE.mode;
  return { mode };
}

export function normalizeTaskTimelineConfiguration(
  configuration?: Partial<SavedViewTimelineConfiguration>,
): SavedViewTimelineConfiguration {
  const zoom = ["days", "weeks", "months"].includes(configuration?.zoom as string)
    ? (configuration?.zoom as SavedViewTimelineConfiguration["zoom"])
    : DEFAULT_TASK_TIMELINE_STATE.zoom;
  return {
    zoom,
    showCritical: typeof configuration?.showCritical === "boolean" ? configuration.showCritical : false,
  };
}

export function normalizeTaskListConfiguration(
  configuration?: Partial<SavedViewListConfiguration>,
): SavedViewListConfiguration {
  const validGroupBy = ["none", "status", "priority"].includes(configuration?.groupBy as string)
    ? (configuration?.groupBy as SavedViewListConfiguration["groupBy"])
    : DEFAULT_TASK_LIST_STATE.groupBy;
  return {
    sorting: (configuration?.sorting ?? DEFAULT_TASK_LIST_STATE.sorting)
      .filter((sort) => columnIds.has(sort.id) && typeof sort.desc === "boolean")
      .slice(0, 3),
    groupBy: validGroupBy,
  };
}

type TaskViewStateStore = {
  table: SavedViewTableConfiguration;
  board: SavedViewBoardConfiguration;
  calendar: SavedViewCalendarConfiguration;
  timeline: SavedViewTimelineConfiguration;
  list: SavedViewListConfiguration;
  setTable: (patch: Partial<SavedViewTableConfiguration>) => void;
  setBoard: (patch: Partial<SavedViewBoardConfiguration>) => void;
  setCalendar: (patch: Partial<SavedViewCalendarConfiguration>) => void;
  setTimeline: (patch: Partial<SavedViewTimelineConfiguration>) => void;
  setList: (patch: Partial<SavedViewListConfiguration>) => void;
  apply: (configuration: SavedViewConfiguration) => void;
  resetTable: () => void;
  resetAll: () => void;
};

export const useTaskViewStateStore = create<TaskViewStateStore>((set) => ({
  table: DEFAULT_TASK_TABLE_STATE,
  board: DEFAULT_TASK_BOARD_STATE,
  calendar: DEFAULT_TASK_CALENDAR_STATE,
  timeline: DEFAULT_TASK_TIMELINE_STATE,
  list: DEFAULT_TASK_LIST_STATE,
  setTable: (patch) => set((state) => ({ table: normalizeTaskTableConfiguration({ ...state.table, ...patch }) })),
  setBoard: (patch) => set((state) => ({ board: normalizeTaskBoardConfiguration({ ...state.board, ...patch }) })),
  setCalendar: (patch) =>
    set((state) => ({ calendar: normalizeTaskCalendarConfiguration({ ...state.calendar, ...patch }) })),
  setTimeline: (patch) =>
    set((state) => ({ timeline: normalizeTaskTimelineConfiguration({ ...state.timeline, ...patch }) })),
  setList: (patch) => set((state) => ({ list: normalizeTaskListConfiguration({ ...state.list, ...patch }) })),
  apply: (configuration) => {
    if (configuration.schemaVersion !== 1 && configuration.schemaVersion !== 2) return;
    set((state) => ({
      table: configuration.table ? normalizeTaskTableConfiguration(configuration.table) : state.table,
      board: configuration.board ? normalizeTaskBoardConfiguration(configuration.board) : state.board,
      calendar: configuration.calendar ? normalizeTaskCalendarConfiguration(configuration.calendar) : state.calendar,
      timeline: configuration.timeline ? normalizeTaskTimelineConfiguration(configuration.timeline) : state.timeline,
      list: configuration.list ? normalizeTaskListConfiguration(configuration.list) : state.list,
    }));
  },
  resetTable: () => set({ table: DEFAULT_TASK_TABLE_STATE }),
  resetAll: () =>
    set({
      table: DEFAULT_TASK_TABLE_STATE,
      board: DEFAULT_TASK_BOARD_STATE,
      calendar: DEFAULT_TASK_CALENDAR_STATE,
      timeline: DEFAULT_TASK_TIMELINE_STATE,
      list: DEFAULT_TASK_LIST_STATE,
    }),
}));

export function currentSavedViewConfiguration(
  viewType: string,
  state: {
    table: SavedViewTableConfiguration;
    board?: SavedViewBoardConfiguration;
    calendar?: SavedViewCalendarConfiguration;
    timeline?: SavedViewTimelineConfiguration;
    list?: SavedViewListConfiguration;
  },
): SavedViewConfiguration {
  if (viewType === "table") {
    return { schemaVersion: 2, table: state.table };
  }
  if (viewType === "board" && state.board) {
    return { schemaVersion: 2, board: state.board };
  }
  if (viewType === "calendar" && state.calendar) {
    return { schemaVersion: 2, calendar: state.calendar };
  }
  if (viewType === "timeline" && state.timeline) {
    return { schemaVersion: 2, timeline: state.timeline };
  }
  if (viewType === "list" && state.list) {
    return { schemaVersion: 2, list: state.list };
  }
  return { schemaVersion: 2 };
}
