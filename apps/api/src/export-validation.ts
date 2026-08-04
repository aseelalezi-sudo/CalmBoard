import { BadRequestException } from "@nestjs/common";
import type { WorkspaceExportFormat } from "@calmboard/database";

const workspaceExportFormats = new Set<WorkspaceExportFormat>(["json", "pdf", "xlsx"]);

export function parseWorkspaceExportFormat(value: unknown): WorkspaceExportFormat {
  const format = value ?? "json";
  if (typeof format !== "string" || !workspaceExportFormats.has(format as WorkspaceExportFormat)) {
    throw new BadRequestException("format must be json, pdf, or xlsx");
  }
  return format as WorkspaceExportFormat;
}
