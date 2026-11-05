import type { Dispatch, SetStateAction } from "react";
import type { Attachment, Comment, Task } from "@/lib/types";
import type { getTaskDetailBundle } from "./api";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Dependencies = {
  load: typeof getTaskDetailBundle;
  setTask: Setter<Task | null>;
  setComments: Setter<Comment[]>;
  setAttachments: Setter<Attachment[]>;
  setSubtasks: Setter<Task[]>;
};

export function createTaskDetailLoader(dependencies: Dependencies) {
  let pending: { scope: string; visibleId: string | null; active: boolean } | undefined;

  const dispose = () => {
    if (pending) pending.active = false;
  };

  const synchronize = (scope: string, visibleId: string | null) => {
    if (pending && (pending.scope !== scope || pending.visibleId !== visibleId)) dispose();
  };

  const load = async (
    task: Pick<Task, "id" | "organizationId" | "workspaceId">,
    optimisticTask: Task | null,
    scope: string,
    onError: () => void,
  ) => {
    dispose();
    const request = { scope, visibleId: optimisticTask?.id ?? null, active: true };
    pending = request;
    const current = () => request.active && pending === request;
    dependencies.setTask(optimisticTask);
    dependencies.setComments([]);
    dependencies.setAttachments([]);
    dependencies.setSubtasks([]);
    try {
      const details = await dependencies.load(task);
      if (!current()) return false;
      request.visibleId = details.task.id;
      dependencies.setTask((previous) => (current() ? details.task : previous));
      dependencies.setComments((previous) => (current() ? details.comments : previous));
      dependencies.setAttachments((previous) => (current() ? details.attachments : previous));
      dependencies.setSubtasks((previous) => (current() ? details.subtasks : previous));
      return true;
    } catch {
      if (current()) onError();
      return false;
    }
  };

  return { load, synchronize, dispose };
}
