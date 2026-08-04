import { BadRequestException } from "@nestjs/common";
import type { DashboardWidgetDefinition, DashboardWidgetId, DashboardWidgetWidth } from "@calmboard/database";
import { isJsonObject } from "./request-validation.js";

const widgetIds = new Set<DashboardWidgetId>([
  "total_tasks",
  "completed_tasks",
  "in_progress_tasks",
  "overdue_tasks",
  "status_chart",
  "project_completion",
  "custom_chart",
  "goals",
  "team_distribution",
  "time_logged",
  "activity",
]);
const widths = new Set<DashboardWidgetWidth>(["small", "medium", "wide", "full"]);
const chartTypes = new Set(["bar", "rank", "donut"]);
const groupings = new Set(["assignee", "priority", "status", "tag"]);
const metrics = new Set(["count", "points", "estimate", "logged"]);

export function parseDashboardWidgets(value: unknown): DashboardWidgetDefinition[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > widgetIds.size) {
    throw new BadRequestException(`widgets must contain between 1 and ${widgetIds.size} items`);
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (!isJsonObject(entry)) throw new BadRequestException(`widgets.${index} must be an object`);
    if (typeof entry.id !== "string" || !widgetIds.has(entry.id as DashboardWidgetId)) {
      throw new BadRequestException(`widgets.${index}.id is unsupported`);
    }
    if (seen.has(entry.id)) throw new BadRequestException(`widgets.${index}.id must be unique`);
    seen.add(entry.id);
    if (typeof entry.width !== "string" || !widths.has(entry.width as DashboardWidgetWidth)) {
      throw new BadRequestException(`widgets.${index}.width is unsupported`);
    }
    const widget: DashboardWidgetDefinition = {
      id: entry.id as DashboardWidgetId,
      width: entry.width as DashboardWidgetWidth,
    };
    if (entry.settings !== undefined) {
      if (entry.id !== "custom_chart" || !isJsonObject(entry.settings)) {
        throw new BadRequestException(`widgets.${index}.settings is unsupported`);
      }
      const chartType = entry.settings.chartType ?? "bar";
      const groupBy = entry.settings.groupBy ?? "priority";
      const metric = entry.settings.metric ?? "count";
      if (!chartTypes.has(String(chartType)) || !groupings.has(String(groupBy)) || !metrics.has(String(metric))) {
        throw new BadRequestException(`widgets.${index}.settings is invalid`);
      }
      widget.settings = {
        chartType: chartType as "bar" | "rank" | "donut",
        groupBy: groupBy as "assignee" | "priority" | "status" | "tag",
        metric: metric as "count" | "points" | "estimate" | "logged",
      };
    }
    return widget;
  });
}

export function parseDashboardExpectedVersion(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestException("expectedVersion must be a non-negative integer");
  }
  return value;
}
