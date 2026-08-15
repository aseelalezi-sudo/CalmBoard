export type TaskReminderPreset = "1h" | "tomorrow" | "2h_before";

const HOUR_MS = 60 * 60 * 1_000;

export function taskReminderTime(preset: TaskReminderPreset, now: Date, dueDate?: string | null) {
  if (preset === "1h") return new Date(now.getTime() + HOUR_MS).toISOString();

  if (preset === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }

  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const reminder = new Date(due.getTime() - 2 * HOUR_MS);
  return reminder.getTime() > now.getTime() ? reminder.toISOString() : null;
}
