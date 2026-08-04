import { apiServiceUrl, jsonRequest, requestJson } from "@/lib/client-api";
import type { WorkspaceExportScope } from "./export-api";

export type ReportSchedule = {
  id: string;
  organizationId: string;
  workspaceId: string;
  createdBy: string;
  name: string;
  format: "pdf" | "xlsx";
  cadence: "daily" | "weekly" | "monthly";
  timezone: string;
  minuteOfDay: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  isEnabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  version: number;
  recipientIds: string[];
};

export type ReportScheduleInput = {
  name: string;
  format: ReportSchedule["format"];
  cadence: ReportSchedule["cadence"];
  timezone: string;
  time: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  recipientIds: string[];
  isEnabled: boolean;
};

function scopedUrl(scope: WorkspaceExportScope) {
  const query = new URLSearchParams({ organizationId: scope.organizationId, workspaceId: scope.workspaceId });
  return `${apiServiceUrl("/workspaces/report-schedules")}?${query.toString()}`;
}

export function listReportSchedules(scope: WorkspaceExportScope) {
  return requestJson<ReportSchedule[]>(scopedUrl(scope));
}

export function createReportSchedule(scope: WorkspaceExportScope, input: ReportScheduleInput) {
  return requestJson<ReportSchedule>(
    apiServiceUrl("/workspaces/report-schedules"),
    jsonRequest("POST", { ...scope, ...input }),
  );
}

export function updateReportSchedule(
  scope: WorkspaceExportScope,
  schedule: ReportSchedule,
  input: ReportScheduleInput,
) {
  return requestJson<ReportSchedule>(
    apiServiceUrl(`/workspaces/report-schedules/${encodeURIComponent(schedule.id)}`),
    jsonRequest("PATCH", { ...scope, ...input, expectedVersion: schedule.version }),
  );
}

export function deleteReportSchedule(scope: WorkspaceExportScope, scheduleId: string) {
  return requestJson<{ ok: true }>(
    apiServiceUrl(`/workspaces/report-schedules/${encodeURIComponent(scheduleId)}`),
    jsonRequest("DELETE", scope),
  );
}

export function reportScheduleTime(schedule: Pick<ReportSchedule, "minuteOfDay">) {
  const hour = Math.floor(schedule.minuteOfDay / 60);
  const minute = schedule.minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
