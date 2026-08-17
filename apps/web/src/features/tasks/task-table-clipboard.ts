import type { Task } from "@/lib/types";

export const TASK_CLIPBOARD_COLUMNS = [
  "title",
  "status",
  "priority",
  "assigneeId",
  "storyPoints",
  "estimatedHours",
  "dueDate",
] as const;

export type TaskClipboardUpdate = Pick<Task, "title" | "status" | "priority"> &
  Partial<Pick<Task, "assigneeId" | "assigneeIds" | "storyPoints" | "estimatedHours" | "dueDate">>;

const validStatuses = new Set(["backlog", "todo", "in_progress", "review", "done", "canceled"]);
const validPriorities = new Set(["low", "medium", "high", "urgent"]);

function encodeCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("\t", " ")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

export function serializeTasksForClipboard(tasks: Task[]) {
  const rows = tasks.map((task) =>
    [
      task.title,
      task.status,
      task.priority,
      task.assigneeId,
      task.storyPoints,
      task.estimatedHours,
      task.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : "",
    ]
      .map(encodeCell)
      .join("\t"),
  );
  return [TASK_CLIPBOARD_COLUMNS.join("\t"), ...rows].join("\n");
}

function optionalNumber(value: string, field: string, rowNumber: number) {
  if (value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000) {
    throw new Error(`Row ${rowNumber}: ${field} must be a number from 0 to 100000.`);
  }
  return parsed;
}

function optionalDate(value: string, rowNumber: number) {
  if (value === "") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(`${value}T00:00:00.000Z`) : null;
  if (
    !match ||
    !date ||
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`Row ${rowNumber}: dueDate must use YYYY-MM-DD.`);
  }
  return `${value}T00:00:00.000Z`;
}

export function parseTaskClipboard(text: string, maxRows = 500): TaskClipboardUpdate[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines.length < 2) throw new Error("Clipboard data must include a header and at least one task row.");
  if (lines.length - 1 > maxRows) throw new Error(`Clipboard data is limited to ${maxRows} task rows.`);

  const header = lines[0]!.split("\t");
  if (
    header.length !== TASK_CLIPBOARD_COLUMNS.length ||
    header.some((value, index) => value !== TASK_CLIPBOARD_COLUMNS[index])
  ) {
    throw new Error(`Clipboard header must be: ${TASK_CLIPBOARD_COLUMNS.join("\\t")}`);
  }

  return lines.slice(1).map((line, index) => {
    const rowNumber = index + 2;
    const values = line.split("\t");
    if (values.length !== TASK_CLIPBOARD_COLUMNS.length) {
      throw new Error(`Row ${rowNumber}: expected ${TASK_CLIPBOARD_COLUMNS.length} columns.`);
    }
    const [title, status, priority, assigneeId, storyPoints, estimatedHours, dueDate] = values.map((value) =>
      value.trim(),
    );
    if (!title) throw new Error(`Row ${rowNumber}: title is required.`);
    if (!validStatuses.has(status!)) throw new Error(`Row ${rowNumber}: unsupported status.`);
    if (!validPriorities.has(priority!)) throw new Error(`Row ${rowNumber}: unsupported priority.`);

    return {
      title: title!,
      status: status!,
      priority: priority!,
      assigneeId: assigneeId || null,
      assigneeIds: assigneeId ? [assigneeId] : [],
      storyPoints: optionalNumber(storyPoints!, "storyPoints", rowNumber),
      estimatedHours: optionalNumber(estimatedHours!, "estimatedHours", rowNumber),
      dueDate: optionalDate(dueDate!, rowNumber),
    };
  });
}
