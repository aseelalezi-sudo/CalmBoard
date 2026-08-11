import { useRef, type Dispatch, type SetStateAction } from "react";
import type {
  CustomField,
  Form,
  FormInput,
  Invitation,
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
  resendInvitationRecord,
  revokeInvitationRecord,
  updateUserSkillsRecord,
  updateWorkspaceRecord,
  createWorkspaceRecord,
  archiveProjectRecord,
  deleteProjectRecord,
  restoreProjectRecord,
  updateProjectRecord,
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
  setInvitations: Setter<Invitation[]>;
  setCustomFields: Setter<CustomField[]>;
  setForms: Setter<Form[]>;
  setNotifications: Setter<Notification[]>;
  setActiveView: (view: string) => void;
  loadWorkspaceModules: (workspaceId: string, organizationId?: string, userId?: string) => Promise<void>;
  t: Translator;
  notify: Notify;
};

export function useWorkspaceOperations(input: WorkspaceOperationsInput) {
  const workspaceSwitchSequence = useRef(0);
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
    setInvitations,
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
    const sequence = workspaceSwitchSequence.current + 1;
    workspaceSwitchSequence.current = sequence;
    setActiveWorkspace(workspace);
    const organization = organizations.find((candidate) => candidate.id === workspace.organizationId);
    if (organization) setActiveOrg(organization);
    setProjects([]);
    setActiveProject(null);
    setTasks([]);
    const [projects] = await Promise.all([
      getProjects(workspace.organizationId, workspace.id),
      loadWorkspaceModules(workspace.id, workspace.organizationId, currentUser?.id),
    ]);
    if (sequence !== workspaceSwitchSequence.current) return;
    if (Array.isArray(projects) && projects.length) {
      setProjects(projects);
      setActiveProject(projects[0]);
    }
  };

  const markAllRead = async () => {
    if (!currentUser || !activeOrg || !activeWorkspace) return;
    await markNotificationsRead({
      userId: currentUser.id,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      markAllRead: true,
    });
    setNotifications((previous) => previous.map((notification) => ({ ...notification, isRead: true })));
  };

  const markAsRead = async (id: string) => {
    if (!currentUser || !activeOrg || !activeWorkspace) return;
    await markNotificationsRead({
      userId: currentUser.id,
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      id,
    });
    setNotifications((previous) =>
      previous.map((notification) => (notification.id === id ? { ...notification, isRead: true } : notification)),
    );
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

  const resendInvitation = async (id: string) => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    const updated = (await resendInvitationRecord(id, {
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser.id,
    })) as Invitation;
    setInvitations((previous) => previous.map((invitation) => (invitation.id === id ? updated : invitation)));
    notify(t("تم تدوير رمز الدعوة وإعادة إرسالها", "Invitation token rotated and resent"));
  };

  const revokeInvitation = async (id: string) => {
    if (!activeOrg || !activeWorkspace || !currentUser) return;
    await revokeInvitationRecord(id, {
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser.id,
    });
    setInvitations((previous) =>
      previous.map((invitation) => (invitation.id === id ? { ...invitation, status: "revoked" } : invitation)),
    );
    notify(t("تم إلغاء الدعوة", "Invitation revoked"));
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

  const updateWorkspace = async (patch: Partial<Workspace>, targetWorkspace = activeWorkspace) => {
    if (!targetWorkspace) return;
    const updated = await updateWorkspaceRecord(targetWorkspace.id, {
      ...patch,
      organizationId: targetWorkspace.organizationId,
      workspaceId: targetWorkspace.id,
      actorId: currentUser?.id,
    });
    if (updated.id) {
      setActiveWorkspace((previous) => (previous?.id === updated.id ? { ...previous, ...updated } : previous));
      setWorkspaces((previous) =>
        previous.map((workspace) => (workspace.id === updated.id ? { ...workspace, ...updated } : workspace)),
      );
      notify(t("تم حفظ إعدادات مساحة العمل ✓", "Workspace settings saved ✓"));
    }
  };

  const createWorkspace = async (input: { name: string; color?: string; icon?: string; description?: string }) => {
    if (!activeOrg || !currentUser) return;
    try {
      const created = await createWorkspaceRecord({
        ...input,
        organizationId: activeOrg.id,
        workspaceId: activeWorkspace?.id || "",
        actorId: currentUser.id,
      });
      if (created.id) {
        setWorkspaces((prev) => [...prev, created]);
        await switchWorkspace(created);
        notify(t("تم إنشاء مساحة العمل بنجاح ✓", "Workspace created successfully ✓"));
      }
    } catch (error) {
      notify(
        error instanceof Error ? error.message : t("تعذر إنشاء مساحة العمل", "Failed to create workspace"),
        "error",
      );
      throw error;
    }
  };

  const projectScope = () => {
    if (!activeOrg || !activeWorkspace) return null;
    return {
      organizationId: activeOrg.id,
      workspaceId: activeWorkspace.id,
      actorId: currentUser?.id,
    };
  };

  const replaceProject = (updated: Project) => {
    setProjects((previous) => previous.map((project) => (project.id === updated.id ? updated : project)));
    setActiveProject((previous) => (previous?.id === updated.id ? updated : previous));
  };

  const updateProject = async (project: Project, patch: Partial<Project>) => {
    const scope = projectScope();
    if (!scope) return;
    const updated = await updateProjectRecord(project.id, {
      ...scope,
      ...patch,
      expectedVersion: project.version,
    });
    replaceProject(updated);
    notify(t("تم تحديث المشروع", "Project updated"));
  };

  const archiveProject = async (project: Project) => {
    const scope = projectScope();
    if (!scope) return;
    const updated = await archiveProjectRecord(project, scope);
    replaceProject(updated);
    notify(t("تمت أرشفة المشروع", "Project archived"));
  };

  const restoreProject = async (project: Project) => {
    const scope = projectScope();
    if (!scope) return;
    const updated = await restoreProjectRecord(project, scope);
    replaceProject(updated);
    notify(t("تمت استعادة المشروع", "Project restored"));
  };

  const deleteProject = async (project: Project) => {
    const scope = projectScope();
    if (!scope) return;
    await deleteProjectRecord(project, scope);
    setProjects((previous) => previous.filter((candidate) => candidate.id !== project.id));
    setActiveProject((previous) => (previous?.id === project.id ? null : previous));
    setTasks((previous) => (activeProject?.id === project.id ? [] : previous));
    notify(t("تم حذف المشروع", "Project deleted"));
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
    markAsRead,
    updateMemberRole,
    resendInvitation,
    revokeInvitation,
    updateUserSkills,
    updateWorkspace,
    createWorkspace,
    updateProject,
    archiveProject,
    restoreProject,
    deleteProject,
    createCustomField,
    deleteCustomField,
    createForm,
    updateForm,
    toggleForm,
  };
}
