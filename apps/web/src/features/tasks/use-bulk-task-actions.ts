import type { Task } from "@/lib/types";
import { deleteTaskRecord } from "@/features/tasks/api";

export function useBulkTaskActions(tasks: Task[], actorId?: string) {
  const deleteTasks = async (taskIds: string[]) => {
    const selectedTasks = tasks.filter((task) => taskIds.includes(task.id));
    await Promise.all(selectedTasks.map((task) => deleteTaskRecord(task, actorId)));
  };

  return { deleteTasks };
}
