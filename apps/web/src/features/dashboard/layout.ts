import type { DashboardWidget, DashboardWidgetId, DashboardWidgetWidth } from "@/lib/types";

const widthOrder: DashboardWidgetWidth[] = ["small", "medium", "wide", "full"];

export const defaultDashboardWidgets: DashboardWidget[] = [
  { id: "total_tasks", width: "small" },
  { id: "completed_tasks", width: "small" },
  { id: "in_progress_tasks", width: "small" },
  { id: "overdue_tasks", width: "small" },
  { id: "status_chart", width: "wide" },
  { id: "project_completion", width: "medium" },
  {
    id: "custom_chart",
    width: "full",
    settings: { chartType: "bar", groupBy: "priority", metric: "count" },
  },
  { id: "goals", width: "medium" },
  { id: "team_distribution", width: "medium" },
  { id: "time_logged", width: "medium" },
  { id: "activity", width: "full" },
];

export function reorderDashboardWidgets(
  widgets: DashboardWidget[],
  activeId: DashboardWidgetId,
  overId: DashboardWidgetId,
) {
  const from = widgets.findIndex((widget) => widget.id === activeId);
  const to = widgets.findIndex((widget) => widget.id === overId);
  if (from < 0 || to < 0 || from === to) return widgets;
  const reordered = [...widgets];
  const [moved] = reordered.splice(from, 1);
  if (!moved) return widgets;
  reordered.splice(to, 0, moved);
  return reordered;
}

export function nextDashboardWidgetWidth(width: DashboardWidgetWidth) {
  const index = widthOrder.indexOf(width);
  return widthOrder[(index + 1) % widthOrder.length] ?? "small";
}
