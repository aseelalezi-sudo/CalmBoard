import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export type WorkspaceExportArchive = {
  exportVersion: string;
  generatedAt: string;
  organizationId: string;
  workspace: Record<string, unknown>;
  members?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  goals?: Array<Record<string, unknown>>;
  time_logs?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

const arabicFontPath = fileURLToPath(new URL("../assets/NotoSansArabic.ttf", import.meta.url));
const arabicPattern = /[\u0600-\u06ff]/;
const reportContentTypes = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rows(archive: WorkspaceExportArchive, key: string) {
  const value = archive[key];
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function workspaceName(archive: WorkspaceExportArchive) {
  return text(archive.workspace.name) || text(archive.workspace.slug) || "Workspace";
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  row.alignment = { vertical: "middle", horizontal: "center" };
  row.height = 24;
}

function addWorksheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Array<{ header: string; key: string; width: number }>,
  records: Array<Record<string, unknown>>,
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: true }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = columns;
  styleHeader(sheet.getRow(1));
  for (const record of records) {
    sheet.addRow(
      Object.fromEntries(
        columns.map((column) => {
          const value = record[column.key];
          return [column.key, typeof value === "number" || typeof value === "boolean" ? value : text(value)];
        }),
      ),
    );
  }
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(columns.length).letter}1` };
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    }
    row.alignment = { vertical: "middle", horizontal: "right", wrapText: true };
  });
  return sheet;
}

export async function createWorkspaceXlsx(archive: WorkspaceExportArchive) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CalmBoard";
  workbook.company = "CalmBoard";
  workbook.created = new Date(archive.generatedAt);
  workbook.modified = new Date(archive.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = true;

  const projects = rows(archive, "projects");
  const tasks = rows(archive, "tasks");
  const goals = rows(archive, "goals");
  const timeLogs = rows(archive, "time_logs");
  const members = rows(archive, "members");
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter(
    (task) =>
      task.status !== "done" &&
      Boolean(task.due_date) &&
      new Date(text(task.due_date)).getTime() < new Date(archive.generatedAt).getTime(),
  ).length;

  const summary = workbook.addWorksheet("الملخص - Summary", {
    views: [{ rightToLeft: true }],
  });
  summary.columns = [
    { key: "metric", width: 34 },
    { key: "value", width: 24 },
  ];
  summary.addRows([
    ["مساحة العمل / Workspace", workspaceName(archive)],
    ["وقت الإنشاء / Generated at", archive.generatedAt],
    ["المشاريع / Projects", projects.length],
    ["المهام / Tasks", tasks.length],
    ["المهام المكتملة / Completed", done],
    ["المهام المتأخرة / Overdue", overdue],
    ["الأهداف / Goals", goals.length],
    ["الأعضاء / Members", members.length],
    ["الدقائق المسجلة / Logged minutes", timeLogs.reduce((sum, entry) => sum + number(entry.duration_minutes), 0)],
  ]);
  summary.getColumn(1).font = { bold: true, color: { argb: "FF312E81" } };
  summary.eachRow((row) => {
    row.alignment = { vertical: "middle", horizontal: "right" };
    row.height = 23;
  });

  addWorksheet(
    workbook,
    "المشاريع - Projects",
    [
      { header: "المعرف / ID", key: "id", width: 38 },
      { header: "الاسم / Name", key: "name", width: 34 },
      { header: "الحالة / Status", key: "status", width: 16 },
      { header: "الأولوية / Priority", key: "priority", width: 14 },
      { header: "التقدم / Progress", key: "progress", width: 12 },
      { header: "البدء / Start", key: "start_date", width: 20 },
      { header: "الاستحقاق / Due", key: "due_date", width: 20 },
      { header: "المالك / Owner", key: "owner_id", width: 38 },
    ],
    projects,
  );
  addWorksheet(
    workbook,
    "المهام - Tasks",
    [
      { header: "الرقم / Serial", key: "serial", width: 18 },
      { header: "العنوان / Title", key: "title", width: 44 },
      { header: "المشروع / Project", key: "project_id", width: 38 },
      { header: "الحالة / Status", key: "status", width: 16 },
      { header: "الأولوية / Priority", key: "priority", width: 14 },
      { header: "المسند إليه / Assignee", key: "assignee_id", width: 38 },
      { header: "التقدم / Progress", key: "progress", width: 12 },
      { header: "البدء / Start", key: "start_date", width: 20 },
      { header: "الاستحقاق / Due", key: "due_date", width: 20 },
      { header: "النقاط / Points", key: "story_points", width: 12 },
      { header: "الساعات المقدرة / Estimated", key: "estimated_hours", width: 16 },
      { header: "الساعات المسجلة / Logged", key: "logged_hours", width: 16 },
    ],
    tasks,
  );
  addWorksheet(
    workbook,
    "الأهداف - Goals",
    [
      { header: "العنوان / Title", key: "title", width: 40 },
      { header: "النوع / Type", key: "type", width: 18 },
      { header: "الحالة / Status", key: "status", width: 16 },
      { header: "التقدم / Progress", key: "progress", width: 12 },
      { header: "الحالي / Current", key: "current_value", width: 14 },
      { header: "المستهدف / Target", key: "target_value", width: 14 },
      { header: "الاستحقاق / Due", key: "due_date", width: 20 },
    ],
    goals,
  );
  addWorksheet(
    workbook,
    "الوقت - Time Logs",
    [
      { header: "المهمة / Task", key: "task_id", width: 38 },
      { header: "المستخدم / User", key: "user_id", width: 38 },
      { header: "البداية / Started", key: "started_at", width: 24 },
      { header: "النهاية / Ended", key: "ended_at", width: 24 },
      { header: "الدقائق / Minutes", key: "duration_minutes", width: 14 },
      { header: "قابل للفوترة / Billable", key: "billable", width: 16 },
      { header: "الوصف / Description", key: "description", width: 42 },
    ],
    timeLogs,
  );

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function usePdfFont(document: PDFKit.PDFDocument, value: string, bold = false) {
  if (arabicPattern.test(value)) return document.font("NotoArabic");
  return document.font(bold ? "Helvetica-Bold" : "Helvetica");
}

function pdfText(
  document: PDFKit.PDFDocument,
  value: unknown,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions,
  bold = false,
  fontSize = 8,
  color = "#334155",
) {
  const normalized = text(value);
  usePdfFont(document, normalized, bold);
  document.fontSize(fontSize).fillColor(color);
  document.text(normalized || "-", x, y, {
    ...options,
    align: arabicPattern.test(normalized) ? "right" : options.align,
  });
}

export async function createWorkspacePdf(archive: WorkspaceExportArchive) {
  const document = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 36,
    bufferPages: true,
    info: {
      Title: `CalmBoard workspace report - ${workspaceName(archive)}`,
      Author: "CalmBoard",
      Creator: "CalmBoard server export worker",
      CreationDate: new Date(archive.generatedAt),
    },
  });
  document.registerFont("NotoArabic", arabicFontPath);
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  const projects = rows(archive, "projects");
  const tasks = rows(archive, "tasks");
  const goals = rows(archive, "goals");
  const timeLogs = rows(archive, "time_logs");
  const generatedAt = new Date(archive.generatedAt);
  const done = tasks.filter((task) => task.status === "done").length;
  const overdue = tasks.filter(
    (task) =>
      task.status !== "done" &&
      Boolean(task.due_date) &&
      new Date(text(task.due_date)).getTime() < generatedAt.getTime(),
  ).length;
  const projectNames = new Map(projects.map((project) => [text(project.id), text(project.name)]));

  document.rect(0, 0, document.page.width, 92).fill("#312e81");
  document.fillColor("#ffffff").font("Helvetica-Bold").fontSize(23).text("CalmBoard", 36, 24);
  pdfText(
    document,
    workspaceName(archive),
    320,
    24,
    { width: document.page.width - 356, align: "right", ellipsis: true },
    true,
    23,
    "#ffffff",
  );
  document
    .font("Helvetica")
    .fontSize(9)
    .fillColor("#e0e7ff")
    .text(`Server-generated workspace report • ${generatedAt.toISOString()}`, 36, 61);

  const metrics = [
    ["Projects", projects.length],
    ["Tasks", tasks.length],
    ["Completed", done],
    ["Overdue", overdue],
    ["Goals", goals.length],
    ["Logged hours", Math.round(timeLogs.reduce((sum, log) => sum + number(log.duration_minutes), 0) / 6) / 10],
  ] as const;
  const metricWidth = (document.page.width - 72 - 50) / metrics.length;
  metrics.forEach(([label, value], index) => {
    const x = 36 + index * (metricWidth + 10);
    document.roundedRect(x, 112, metricWidth, 58, 6).fill("#eef2ff");
    document
      .fillColor("#312e81")
      .font("Helvetica-Bold")
      .fontSize(18)
      .text(String(value), x + 8, 123, {
        width: metricWidth - 16,
        align: "center",
      });
    document
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(8)
      .text(label, x + 8, 149, {
        width: metricWidth - 16,
        align: "center",
      });
  });

  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text("Project summary", 36, 194);
  let y = 220;
  const projectColumns = [
    { key: "name", label: "Project", width: 230 },
    { key: "status", label: "Status", width: 95 },
    { key: "priority", label: "Priority", width: 85 },
    { key: "progress", label: "Progress", width: 75 },
    { key: "due_date", label: "Due date", width: 130 },
  ] as const;

  const addTableHeader = (columns: ReadonlyArray<{ label: string; width: number }>, startY: number) => {
    let x = 36;
    document
      .rect(
        36,
        startY,
        columns.reduce((sum, column) => sum + column.width, 0),
        24,
      )
      .fill("#4f46e5");
    for (const column of columns) {
      document
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(column.label, x + 5, startY + 8, {
          width: column.width - 10,
          ellipsis: true,
        });
      x += column.width;
    }
    return startY + 24;
  };
  y = addTableHeader(projectColumns, y);
  for (const project of projects) {
    if (y > document.page.height - 58) {
      document.addPage();
      y = addTableHeader(projectColumns, 36);
    }
    let x = 36;
    document
      .rect(
        36,
        y,
        projectColumns.reduce((sum, column) => sum + column.width, 0),
        23,
      )
      .fill(Math.round(y / 23) % 2 ? "#ffffff" : "#f8fafc");
    for (const column of projectColumns) {
      pdfText(document, project[column.key], x + 5, y + 6, { width: column.width - 10, ellipsis: true });
      x += column.width;
    }
    y += 23;
  }

  document.addPage();
  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(15).text("Task details", 36, 32);
  const taskColumns = [
    { key: "serial", label: "Serial", width: 90 },
    { key: "title", label: "Task", width: 247 },
    { key: "project", label: "Project", width: 155 },
    { key: "status", label: "Status", width: 85 },
    { key: "priority", label: "Priority", width: 75 },
    { key: "progress", label: "%", width: 42 },
    { key: "due_date", label: "Due", width: 76 },
  ] as const;
  y = addTableHeader(taskColumns, 58);
  for (const task of tasks) {
    if (y > document.page.height - 58) {
      document.addPage();
      y = addTableHeader(taskColumns, 36);
    }
    let x = 36;
    document
      .rect(
        36,
        y,
        taskColumns.reduce((sum, column) => sum + column.width, 0),
        23,
      )
      .fill(Math.round(y / 23) % 2 ? "#ffffff" : "#f8fafc");
    for (const column of taskColumns) {
      const value = column.key === "project" ? projectNames.get(text(task.project_id)) : task[column.key];
      pdfText(document, value, x + 4, y + 6, { width: column.width - 8, ellipsis: true });
      x += column.width;
    }
    y += 23;
  }
  if (!tasks.length) {
    document
      .fillColor("#64748b")
      .font("Helvetica")
      .fontSize(10)
      .text("No active tasks.", 36, y + 16);
  }

  const pageRange = document.bufferedPageRange();
  for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex += 1) {
    document.switchToPage(pageIndex);
    document
      .fillColor("#94a3b8")
      .font("Helvetica")
      .fontSize(8)
      .text(`CalmBoard • ${pageIndex + 1}/${pageRange.count}`, 36, document.page.height - 25, {
        width: document.page.width - 72,
        align: "center",
      });
  }
  document.end();
  return completed;
}

export function workspaceReportContentType(format: "pdf" | "xlsx") {
  return reportContentTypes[format];
}
