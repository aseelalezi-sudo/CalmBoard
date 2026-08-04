export const TASK_TABLE_COLUMN_ORDER = [
  "select",
  "title",
  "status",
  "priority",
  "assignee",
  "points",
  "estimate",
  "logged",
  "due",
] as const;

export type TaskTableColumnId = (typeof TASK_TABLE_COLUMN_ORDER)[number];

export function moveTableColumn(order: string[], columnId: string, direction: -1 | 1) {
  const currentIndex = order.indexOf(columnId);
  if (currentIndex < 0) return order;
  const targetIndex = currentIndex + direction;
  if (targetIndex < 1 || targetIndex >= order.length) return order;
  const next = [...order];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex]!, next[currentIndex]!];
  return next;
}

export function normalizeTableColumnOrder(order: string[]) {
  const known = new Set<string>(TASK_TABLE_COLUMN_ORDER);
  const normalized = order.filter((column, index) => known.has(column) && order.indexOf(column) === index);
  for (const column of TASK_TABLE_COLUMN_ORDER) {
    if (!normalized.includes(column)) normalized.push(column);
  }
  const selectionIndex = normalized.indexOf("select");
  if (selectionIndex > 0) {
    normalized.splice(selectionIndex, 1);
    normalized.unshift("select");
  }
  return normalized;
}
