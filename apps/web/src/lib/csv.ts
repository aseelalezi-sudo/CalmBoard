// Cells beginning with these characters are interpreted as formulas by Excel, LibreOffice and Google Sheets.
// Prefixing a single quote stores them as text (OWASP "CSV injection").
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = FORMULA_TRIGGER.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function buildCsv(head: readonly unknown[], rows: ReadonlyArray<readonly unknown[]>): string {
  const line = (cells: readonly unknown[]) => cells.map(escapeCsvCell).join(",");
  return "﻿" + [line(head), ...rows.map(line)].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
