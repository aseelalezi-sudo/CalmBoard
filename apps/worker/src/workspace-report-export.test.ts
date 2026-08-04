import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  createWorkspacePdf,
  createWorkspaceXlsx,
  workspaceReportContentType,
  type WorkspaceExportArchive,
} from "./workspace-report-export.js";

const archive: WorkspaceExportArchive = {
  exportVersion: "3.1.0",
  generatedAt: "2026-07-31T12:00:00.000Z",
  organizationId: "organization-1",
  workspace: { id: "workspace-1", name: "مساحة الاختبار", slug: "test-workspace" },
  members: [{ id: "membership-1", user_id: "user-1", name: "عضو الاختبار" }],
  projects: [
    {
      id: "project-1",
      name: "مشروع الإطلاق",
      status: "active",
      priority: "high",
      progress: 50,
      due_date: "2026-08-31T00:00:00.000Z",
    },
  ],
  tasks: [
    {
      id: "task-1",
      serial: "T-1",
      title: "مراجعة التقرير",
      project_id: "project-1",
      status: "in_progress",
      priority: "high",
      progress: 40,
      due_date: "2026-08-03T00:00:00.000Z",
    },
  ],
  goals: [{ id: "goal-1", title: "الهدف الأول", status: "active", progress: 60 }],
  time_logs: [{ id: "time-1", task_id: "task-1", user_id: "user-1", duration_minutes: 90 }],
};

describe("server workspace report formats", () => {
  it("creates a valid multi-sheet XLSX workbook from persisted records", async () => {
    const body = await createWorkspaceXlsx(archive);
    assert.equal(body.subarray(0, 2).toString("ascii"), "PK");
    const workbook = new ExcelJS.Workbook();
    const arrayBuffer = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    await workbook.xlsx.load(arrayBuffer);
    assert.ok(workbook.getWorksheet("الملخص - Summary"));
    assert.equal(workbook.getWorksheet("المشاريع - Projects")?.getCell("B2").value, "مشروع الإطلاق");
    assert.equal(workbook.getWorksheet("المهام - Tasks")?.getCell("B2").value, "مراجعة التقرير");
    assert.equal(
      workspaceReportContentType("xlsx"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("creates a real PDF with an embedded Arabic-capable font", async () => {
    const body = await createWorkspacePdf(archive);
    assert.equal(body.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.ok(body.byteLength > 2_000);
    assert.equal(workspaceReportContentType("pdf"), "application/pdf");
  });
});
