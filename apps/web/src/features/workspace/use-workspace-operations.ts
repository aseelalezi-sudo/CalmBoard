import type { Dispatch, SetStateAction } from "react";
import type {
  CustomField,
  Form,
  FormInput,
  Member,
  Notification,
  Organization,
  Project,
  Task,
  User,
  Workspace,
} from "@/lib/types";
import {
  createCustomFieldRecord,
  createFormRecord,
  deleteCustomFieldRecord,
  markNotificationsRead,
  updateFormStatusRecord,
  updateFormRecord,
  updateMemberRoleRecord,
  updateUserSkillsRecord,
  updateWorkspaceRecord,
} from "@/features/workspace/actions-api";
import { getProjects } from "@/features/workspace/api";

type Setter<T> = Dispatch<SetStateAction<T>>;
type Translator = (arabic: string, english: string) => string;
type Notify = (message: string, kind?: "success" | "error") => void;

type WorkspaceOperationsInput = {
  activeWorkspace: Workspace | null;
  activeOrg: Organization | null;
  activeProject: Project | null;
  currentUser: User | null;
  organizations: Organization[];
  setActiveWorkspace: Setter<Workspace | null>;
  setActiveOrg: Setter<Organization | null>;
  setActiveProject: Setter<Project | null>;
  setProjects: Setter<Project[]>;
  setTasks: Setter<Task[]>;
  setWorkspaces: Setter<Workspace[]>;
  setUsers: Setter<User[]>;
  setMembers: Setter<Member[]>;
  setCustomFields: Setter<CustomField[]>;
  setForms: Setter<Form[]>;
  setNotifications: Setter<Notification[]>;
  setActiveView: (view: string) => void;
  loadWorkspaceModules: (workspaceId: string, organizationId?: string, userId?: string) => Promise<void>;
  t: Translator;
  notify: Notify;
};

export function useWorkspaceOperations(input: WorkspaceOperationsInput) {
  const {
    activeWorkspace,
    activeOrg,
    activeProject,
    currentUser,
    organizations,
    setActiveWorkspace,
    setActiveOrg,
    setActiveProject,
    setProjects,
    setTasks,
    setWorkspaces,
    setUsers,
    setMembers,
    setCustomFields,
    setForms,
    setNotifications,
    setActiveView,
    loadWorkspaceModules,
    t,
    notify,
  } = input;

  const switchProject = async (project: Project) => {
    setActiveProject(project);
    setActiveView("table");
    setTasks([]);
  };

  const switchWorkspace = async (workspace: Workspace) => {
    setActiveWorkspace(workspace);
    const organization = organizations.find((candidate) => candidate.id === workspace.organizationId);
    if (organization) setActiveOrg(organization);
    const projects = await getProjects(workspace.organizationId, workspace.id);
    if (Array.isArray(projects) && projects.length) {
      setProjects(projects);
      setActiveProject(projects[0]);
      setTasks([]);
    } else {
      setProjects([]);
      setTasks([]);
      setActiveProject(null);
    }
    await loadWorkspaceModules(workspace.id, workspace.organizationId, currentUser?.id);
  };

  const markAllRead = async () => {
    if (!currentUser || !activeOrg || !activeWorkspace) return;
    await markNotificationsRead({
      userId: currentUser.id,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
    });
    setNotifications((previous) => previous.map((notification) => ({ ...notification, isRead: true })));
  };

  const updateMemberRole = async (id: string, role: string) => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    setMembers((previous) => previous.map((member) => (member.id === id ? { ...member, role } : member)));
    try {
      await updateMemberRoleRecord({
        id,
        role,
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        actorId: currentUser.id,
      });
    } catch (error) {
      await loadWorkspaceModules(activeWorkspace.id, activeOrg.id, currentUser.id);
      notify(error instanceof Error ? error.message : t("تعذر تحديث الدور", "Failed to update role"), "error");
      return;
    }
    notify(t("حُدّث الدور", "Role updated"));
  };

  const updateUserSkills = async (userId: string, skills: string[]) => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    setUsers((previous) => previous.map((user) => (user.id === userId ? { ...user, skills } : user)));
    await updateUserSkillsRecord({
      userId,
      skills,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser.id,
    });
    notify(t("تم تحديث وسوم المهارات بنجاح ✓", "Skills updated ✓"));
  };

  const updateWorkspace = async (patch: Partial<Workspace>) => {
    if (!activeWorkspace || !activeOrg) return;
    const updated = await updateWorkspaceRecord(activeWorkspace.id, {
      ...patch,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
    });
    if (updated.id) {
      setActiveWorkspace((previous) => (previous ? { ...previous, ...updated } : previous));
      setWorkspaces((previous) =>
        previous.map((workspace) => (workspace.id === updated.id ? { ...workspace, ...updated } : workspace)),
      );
      notify(t("تم حفظ إعدادات مساحة العمل ✓", "Workspace settings saved ✓"));
    }
  };

  const createCustomField = async (field: {
    name: string;
    type: string;
    description?: string;
    required?: boolean;
    sensitive?: boolean;
    options?: Array<{ label: string; value: string }>;
  }) => {
    if (!activeWorkspace || !activeOrg || !currentUser) return;
    const created = await createCustomFieldRecord({
      ...field,
      workspaceId: activeWorkspace.id,
      organizationId: activeOrg.id,
      projectId: activeProject?.id,
      actorId: currentUser.id,
    });
    if (created.id) {
      setCustomFields((previous) => [...previous, created]);
      notify(t("تم إنشاء الحقل المخصص ✓", "Custom field created ✓"));
    }
  };

  const deleteCustomField = async (id: string) => {
    if (!activeWorkspace || !activeOrg || !currentUser) return;
    if (!confirm(t("حذف هذا الحقل من مساحة العمل؟", "Delete this workspace custom field?"))) return;
    try {
      await deleteCustomFieldRecord(id, {
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace.id,
        actorId: currentUser.id,
      });
    } catch {
      notify(t("تعذر حذف الحقل", "Failed to delete field"), "error");
      return;
    }
    setCustomFields((previous) => previous.filter((field) => field.id !== id));
    notify(t("تم حذف الحقل", "Field deleted"));
  };

  const createForm = async (input: FormInput) => {
    if (!activeWorkspace || !activeOrg) return;
    const created = await createFormRecord({
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
      ...input,
    });
    if (created.id) {
      setForms((previous) => [created, ...previous]);
      notify(`${t("أُنشئ النموذج", "Form created")} — ${t("الرابط", "link")}: /f/${created.id}`);
    }
  };

  const updateForm = async (id: string, input: FormInput) => {
    if (!activeWorkspace || !activeOrg) return;
    const updated = await updateFormRecord(id, {
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
      ...input,
    });
    setForms((previous) => previous.map((form) => (form.id === id ? updated : form)));
    notify(t("تم حفظ النموذج", "Form saved"));
  };

  const toggleForm = async (id: string, isActive: boolean) => {
    if (!activeWorkspace || !activeOrg) return;
    setForms((previous) => previous.map((form) => (form.id === id ? { ...form, isActive } : form)));
    await updateFormStatusRecord(id, isActive, {
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
    });
  };

  return {
    switchProject,
    switchWorkspace,
    markAllRead,
    updateMemberRole,
    updateUserSkills,
    updateWorkspace,
    createCustomField,
    deleteCustomField,
    createForm,
    updateForm,
    toggleForm,
  };
}
