"use client";

import { create } from "zustand";
import type { SavedViewConfiguration, SavedViewTableConfiguration } from "@/lib/types";
import { normalizeTableColumnOrder, TASK_TABLE_COLUMN_ORDER } from "@/features/tasks/task-table-state";

const columnIds = new Set<string>(TASK_TABLE_COLUMN_ORDER);

export const DEFAULT_TASK_TABLE_STATE: SavedViewTableConfiguration = {
  sorting: [{ id: "title", desc: false }],
  columnVisibility: {},
  columnOrder: [...TASK_TABLE_COLUMN_ORDER],
  columnPinning: { left: ["select", "title"], right: [] },
  columnSizing: {},
};

function knownColumns(values: string[] | undefined) {
  return [...new Set((values ?? []).filter((value) => columnIds.has(value)))];
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
  };
}

type TaskViewStateStore = {
  table: SavedViewTableConfiguration;
  setTable: (patch: Partial<SavedViewTableConfiguration>) => void;
  apply: (configuration: SavedViewConfiguration) => void;
  resetTable: () => void;
};

export const useTaskViewStateStore = create<TaskViewStateStore>((set) => ({
  table: DEFAULT_TASK_TABLE_STATE,
  setTable: (patch) => set((state) => ({ table: normalizeTaskTableConfiguration({ ...state.table, ...patch }) })),
  apply: (configuration) => {
    if (configuration.schemaVersion !== 1 || !configuration.table) return;
    set({ table: normalizeTaskTableConfiguration(configuration.table) });
  },
  resetTable: () => set({ table: DEFAULT_TASK_TABLE_STATE }),
}));

export function currentSavedViewConfiguration(
  viewType: string,
  table: SavedViewTableConfiguration,
): SavedViewConfiguration {
  return viewType === "table" ? { schemaVersion: 1, table } : { schemaVersion: 1 };
}
