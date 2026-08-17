import type { Dispatch, SetStateAction } from "react";
import type {
  Attachment,
  Automation,
  AutomationRun,
  Comment,
  Organization,
  Project,
  Task,
  User,
  Workspace,
} from "@/lib/types";
import { uploadTaskAttachment } from "@/features/attachments/api";
import { getAutomationState } from "@/features/automations/api";
import { createTimeLog } from "@/features/workspace/actions-api";
import {
  createTaskRecord,
  deleteTaskRecord,
  getTaskDetailBundle,
  moveTaskRecord,
  projectTaskScope,
  setProjectWipLimit,
  updateTaskRecord,
} from "@/features/tasks/api";
import { reorderBoardTasks } from "@/features/tasks/board-order";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

type TaskOperationsInput = {
  activeProject: Project | null;
  activeWorkspace: Workspace | null;
  activeOrg: Organization | null;
  currentUser: User | null;
  tasks: Task[];
  taskDetail: Task | null;
  setTasks: Setter<Task[]>;
  setProjects: Setter<Project[]>;
  setActiveProject: Setter<Project | null>;
  setTaskDetail: Setter<Task | null>;
  setComments: Setter<Comment[]>;
  setSubtasks: Setter<Task[]>;
  setAttachments: Setter<Attachment[]>;
  setAutomations: Setter<Automation[]>;
  setAutomationRuns: Setter<AutomationRun[]>;
  setShowAddTask: Setter<boolean>;
  loadWorkspaceModules: (workspaceId: string, organizationId?: string, userId?: string) => Promise<void>;
  reloadTasks: () => Promise<void>;
  t: Translator;
  notify: Notify;
};

export function useTaskOperations(input: TaskOperationsInput) {
  const {
    activeProject,
    activeWorkspace,
    activeOrg,
    currentUser,
    tasks,
    taskDetail,
    setTasks,
    setProjects,
    setActiveProject,
    setTaskDetail,
    setComments,
    setSubtasks,
    setAttachments,
    setAutomations,
    setAutomationRuns,
    setShowAddTask,
    loadWorkspaceModules,
    reloadTasks,
    t,
    notify,
  } = input;

  const refreshTasks = reloadTasks;

  const updateTask = async (id: string, updates: Partial<Task>) => {
    const targetTask = tasks.find((task) => task.id === id) ?? (taskDetail?.id === id ? taskDetail : null);
    if (!targetTask) return false;
    const snapshot = tasks;
    setTasks((previous) => previous.map((task) => (task.id === id ? ({ ...task, ...updates } as Task) : task)));
    if (taskDetail?.id === id) {
      setTaskDetail((previous) => (previous ? ({ ...previous, ...updates } as Task) : null));
    }
    try {
      const canonical = await updateTaskRecord({
        id,
        ...updates,
        expectedVersion: targetTask.version,
        organizationId: targetTask.organizationId,
        workspaceId: targetTask.workspaceId,
        actorId: currentUser?.id,
      });
      setTasks((previous) => previous.map((task) => (task.id === id ? canonical : task)));
      if (taskDetail?.id === id) {
        setTaskDetail(canonical);
      }
      setSubtasks((previous) => previous.map((task) => (task.id === id ? canonical : task)));

      if (
        updates.status !== undefined ||
        "assigneeId" in updates ||
        "assigneeIds" in updates ||
        updates.priority !== undefined
      ) {
        await refreshTasks();
        if (activeWorkspace && activeOrg) {
          const state = await getAutomationState({
            organizationId: activeOrg.id,
            workspaceId: activeWorkspace.id,
          }).catch(() => null);
          if (state?.automations) {
            setAutomations(state.automations);
            setAutomationRuns(state.runs || []);
          }
        }
      }
      return true;
    } catch {
      setTasks(snapshot);
      notify(t("تعذر تحديث المهمة. بقيت حالتها السابقة.", "Save failed, reverted"), "error");
      return false;
    }
  };

  const moveTask = async (
    id: string,
    status: string,
    targetIndex: number,
    anchors: { beforeTaskId: string | null; afterTaskId: string | null },
  ) => {
    const targetTask = tasks.find((task) => task.id === id);
    if (!targetTask || !currentUser) return;
    const snapshot = tasks;
    setTasks(reorderBoardTasks(tasks, id, status, targetIndex));
    try {
      await moveTaskRecord(targetTask, status, targetIndex, anchors, currentUser.id);
      await refreshTasks();
    } catch {
      setTasks(snapshot);
      notify(
        t("تعذر نقل المهمة. أُعيد ترتيب اللوحة السابق.", "Failed to move task. Previous board order restored."),
        "error",
      );
    }
  };

  const updateProjectWipLimit = async (status: string, limit: number | null) => {
    if (!activeProject || !currentUser) return;
    try {
      const wipLimits = await setProjectWipLimit(activeProject, status, limit, currentUser.id);
      const updateProject = (project: Project) =>
        project.id === activeProject.id ? { ...project, wipLimits } : project;
      setProjects((projects) => projects.map(updateProject));
      setActiveProject((project) => (project ? updateProject(project) : project));
    } catch {
      notify(t("تعذر حفظ حد العمل الجاري. حاول مجدداً.", "Could not save WIP limit. Please try again."), "error");
    }
  };

  const createTask = async (data: Partial<Task> & { title: string }) => {
    if (!activeProject || !activeWorkspace || !activeOrg || !currentUser) return false;
    try {
      const created = await createTaskRecord({
        ...projectTaskScope(activeProject, currentUser.id),
        title: data.title,
        description: data.description,
        parentId: data.parentId ?? null,
        status: data.status || "todo",
        priority: data.priority || "medium",
        assigneeId: data.assigneeId !== undefined ? data.assigneeId : undefined,
        assigneeIds: data.assigneeIds,
        followerIds: data.followerIds,
        reporterId: currentUser.id,
        tags: data.tags || [],
        dueDate: data.dueDate,
        storyPoints: data.storyPoints,
        estimatedHours: data.estimatedHours,
      });
      if (!created.id) throw new Error("task_not_created");
      notify(`${t("تم إنشاء", "Created")} ${created.serial}`);
      await refreshTasks();
      setShowAddTask(false);
      return true;
    } catch {
      notify(
        t("تعذر إنشاء المهمة. راجع البيانات وحاول مجدداً.", "Could not create task. Check details and try again."),
        "error",
      );
      return false;
    }
  };

  const loadTaskDetail = async (
    task: Pick<Task, "id" | "organizationId" | "workspaceId">,
    optimisticTask: Task | null,
  ) => {
    setTaskDetail(optimisticTask);
    setComments([]);
    setSubtasks([]);
    setAttachments([]);
    try {
      const details = await getTaskDetailBundle(task);
      setTaskDetail(details.task);
      setComments(details.comments);
      setAttachments(details.attachments);
      setSubtasks(details.subtasks);
    } catch {
      notify(t("تعذر تحميل التفاصيل", "Could not load details"), "error");
    }
  };

  const openTask = (task: Task) => loadTaskDetail(task, task);
  const openTaskById = (task: Pick<Task, "id" | "organizationId" | "workspaceId">) => loadTaskDetail(task, null);

  const addSubtask = async (title: string) => {
    if (!taskDetail || !activeProject || !activeWorkspace || !activeOrg || !title.trim()) return;
    try {
      const created = await createTaskRecord({
        ...projectTaskScope(activeProject, currentUser?.id),
        parentId: taskDetail.id,
        title: title.trim(),
        status: "todo",
        priority: "medium",
        reporterId: currentUser?.id,
      });
      if (created.id) {
        setSubtasks((previous) => [...previous, created]);
        notify(t("أضيفت مهمة فرعية", "Subtask added"));
        await refreshTasks();
      }
    } catch {
      notify(t("تعذر إضافة المهمة الفرعية.", "Could not add subtask."), "error");
    }
  };

  const toggleSubtask = async (subtask: Task) => {
    const status = subtask.status === "done" ? "todo" : "done";
    const progress = status === "done" ? 100 : 0;
    const snapshot = subtask;
    setSubtasks((previous) => previous.map((item) => (item.id === subtask.id ? { ...item, status, progress } : item)));
    try {
      const updated = await updateTaskRecord({
        id: subtask.id,
        expectedVersion: subtask.version,
        status,
        progress,
        organizationId: subtask.organizationId,
        workspaceId: subtask.workspaceId,
        actorId: currentUser?.id,
      });
      setSubtasks((previous) => previous.map((item) => (item.id === subtask.id ? updated : item)));
      await refreshTasks();
    } catch {
      setSubtasks((previous) => previous.map((item) => (item.id === subtask.id ? snapshot : item)));
      notify(
        t("تعذر تحديث المهمة الفرعية. تمت استعادة حالتها.", "Could not update subtask. Previous state restored."),
        "error",
      );
    }
  };

  const deleteSubtask = async (subtask: Task) => {
    let previousSubtasks: Task[] = [];
    setSubtasks((previous) => {
      previousSubtasks = previous;
      return previous.filter((item) => item.id !== subtask.id);
    });
    try {
      await deleteTaskRecord(subtask, currentUser?.id);
      notify(t("تم حذف المهمة الفرعية بنجاح", "Subtask deleted successfully"));
      await refreshTasks();
    } catch {
      setSubtasks(previousSubtasks);
      notify(t("تعذر حذف المهمة الفرعية.", "Could not delete subtask."), "error");
    }
  };

  const logTime = async (taskId: string, minutes: number, description: string) => {
    if (!currentUser || !activeOrg || !activeWorkspace || minutes < 1) return;
    const timeLog = await createTimeLog({
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser.id,
      taskId,
      durationMinutes: minutes,
      description,
    });
    if (timeLog.id) {
      notify(`${t("سُجّل", "Logged")} ${minutes}m`);
      if (activeWorkspace) await loadWorkspaceModules(activeWorkspace.id, activeOrg?.id, currentUser.id);
      await refreshTasks();
    }
  };

  const addAttachment = async (taskId: string, file: File) => {
    if (!currentUser || !activeOrg || !activeWorkspace) return;
    try {
      const attachment = await uploadTaskAttachment({
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        taskId,
        uploaderId: currentUser.id,
        file,
      });
      setAttachments((previous) => [attachment, ...previous]);
      notify(t("تم رفع المرفق بنجاح", "Attachment uploaded"));
    } catch {
      notify(
        t("تعذر رفع المرفق. تحقق من الملف والاتصال.", "Could not upload attachment. Check file and connection."),
        "error",
      );
    }
  };

  const deleteTask = async (taskId: string) => {
    const target = tasks.find((t) => t.id === taskId) ?? (taskDetail?.id === taskId ? taskDetail : null);
    if (!target) return false;
    const snapshotTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== taskId && t.parentId !== taskId));
    setSubtasks((prev) => prev.filter((t) => t.id !== taskId));
    if (taskDetail?.id === taskId) {
      setTaskDetail(null);
    }
    try {
      await deleteTaskRecord(target, currentUser?.id);
      notify(t("تم حذف المهمة بنجاح", "Task deleted successfully"));
      await refreshTasks();
      return true;
    } catch {
      setTasks(snapshotTasks);
      notify(t("تعذر حذف المهمة. تحقق من الاتصال.", "Could not delete task. Check connection."), "error");
      return false;
    }
  };

  return {
    refreshTasks,
    updateTask,
    deleteTask,
    moveTask,
    updateProjectWipLimit,
    createTask,
    openTask,
    openTaskById,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    logTime,
    addAttachment,
  };
}
