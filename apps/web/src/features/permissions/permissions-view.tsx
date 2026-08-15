"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  Empty,
  Field,
  Modal,
  ScreenHeader,
  ScreenState,
  SegmentedTabs,
  areaCls,
  inputCls,
  selectCls,
} from "@/components/ui";
import { IconCheck, IconPlus, IconSearch, IconShield, IconTrash, IconUsers, IconX } from "@/components/icons";
import { confirmAction } from "@/components/feedback";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  archiveAuthorizationRole,
  assignAuthorizationRole,
  createAuthorizationRole,
  getAuthorizationCatalog,
  removeAuthorizationBinding,
  removeAuthorizationOverride,
  setAuthorizationOverride,
  updateAuthorizationRole,
  type AuthorizationBinding,
  type AuthorizationCatalog,
  type AuthorizationOverride,
  type AuthorizationPermission,
  type AuthorizationRole,
  type AuthorizationScopeName,
  type PermissionOverrideEffect,
} from "./api";
import { effectivePermissionKeys, exactScopeMatch, memberDirectory, type PermissionScope } from "./permissions-model";

type Tab = "roles" | "members";
type RoleDraft = { id?: string; key: string; name: string; description: string; permissionKeys: string[] };

const emptyDraft: RoleDraft = { key: "", name: "", description: "", permissionKeys: [] };

function newRoleDraft(): RoleDraft {
  return { ...emptyDraft, key: `role-${Date.now().toString(36)}` };
}

const categoryLabels: Record<string, [string, string]> = {
  organization: ["المؤسسة", "Organization"],
  workspace: ["مساحة العمل", "Workspace"],
  members: ["الأعضاء", "Members"],
  projects: ["المشاريع", "Projects"],
  tasks: ["المهام", "Tasks"],
  reporting: ["التقارير", "Reporting"],
  billing: ["الفوترة", "Billing"],
  security: ["الأمان والبيانات", "Security & data"],
  integrations: ["التكاملات", "Integrations"],
  documents: ["المستندات", "Documents"],
  forms: ["النماذج", "Forms"],
  goals: ["الأهداف", "Goals"],
  sprints: ["السبرنتات", "Sprints"],
  time: ["الوقت والجداول", "Time & timesheets"],
  collaboration: ["التعاون", "Collaboration"],
  content: ["المحتوى", "Content"],
  planning: ["التخطيط", "Planning"],
  notifications: ["الإشعارات", "Notifications"],
};

const permissionLabels: Record<string, [string, string]> = {
  "organization.manage": ["إدارة المؤسسة", "تغيير إعدادات المؤسسة والإعدادات الحساسة المرتبطة بالملكية"],
  "workspace.manage": ["إدارة مساحة العمل", "تغيير إعدادات مساحة العمل وهيكلها"],
  "members.manage": ["إدارة الأعضاء", "تغيير أدوار العضوية وحالتها"],
  "members.invite": ["دعوة الأعضاء", "دعوة المستخدمين إلى المؤسسة أو مساحة العمل"],
  "projects.create": ["إنشاء المشاريع", "إنشاء مشاريع في مساحة عمل مسموح بها"],
  "projects.update": ["تحديث المشاريع", "تحديث إعدادات المشروع ومحتواه"],
  "projects.delete": ["حذف المشاريع", "أرشفة المشاريع أو حذفها"],
  "projects.view_private": ["عرض المشاريع الخاصة", "عرض المشاريع المعلّمة على أنها خاصة"],
  "tasks.create": ["إنشاء المهام", "إنشاء مهام في مشروع مسموح به"],
  "tasks.update": ["تحديث المهام", "تحديث محتوى المهمة وحالة سير العمل"],
  "tasks.update_others": ["تحديث مهام الآخرين", "تحديث المهام التي يملكها أو أُسندت إلى مستخدمين آخرين"],
  "tasks.delete": ["حذف المهام", "أرشفة المهام أو حذفها"],
  "comments.manage": ["إدارة التعليقات", "إنشاء التعليقات وتحديثها والتفاعل معها أو حذفها"],
  "attachments.manage": ["إدارة المرفقات", "رفع مرفقات المهام والمشاريع أو حذفها"],
  "documents.manage": ["إدارة المستندات", "إنشاء المستندات وتحديثها وإصداراتها أو استعادتها"],
  "forms.manage": ["إدارة النماذج", "إنشاء نماذج مساحة العمل وتهيئتها"],
  "goals.manage": ["إدارة الأهداف", "إنشاء الأهداف وتحديثها وتسجيلات تقدمها"],
  "saved_views.manage": ["إدارة طرق العرض المحفوظة", "إنشاء طرق عرض مساحة العمل المحفوظة وحذفها"],
  "time_logs.manage": ["إدارة سجلات الوقت", "إنشاء إدخالات الوقت الشخصية"],
  "timesheets.review": ["مراجعة جداول الوقت", "مراجعة جداول الوقت والموافقة عليها أو رفضها"],
  "notifications.manage": ["إدارة الإشعارات", "تحديث حالة الإشعارات الشخصية"],
  "notifications.dispatch": ["إرسال الإشعارات", "إرسال ملخصات المؤسسة أو مساحة العمل"],
  "branches.manage": ["إدارة الفروع", "إنشاء فروع المؤسسة وتحديثها"],
  "custom_fields.manage": ["إدارة الحقول المخصصة", "إنشاء الحقول المخصصة أو تحديثها أو حذفها"],
  "automations.manage": ["إدارة الأتمتة", "إنشاء قواعد الأتمتة وتحديثها وتشغيلها أو حذفها"],
  "reports.view": ["عرض التقارير", "عرض التقارير التشغيلية والتحليلية"],
  "billing.manage": ["إدارة الفوترة", "إدارة الاشتراكات والفواتير وإعدادات الدفع"],
  "data.export": ["تصدير البيانات", "تصدير بيانات المؤسسة أو مساحة العمل"],
  "integrations.manage": ["إدارة التكاملات", "تهيئة التكاملات الخارجية وحذفها"],
  "audit.view": ["عرض سجل التدقيق", "عرض سجل الأمان والتدقيق"],
  "sprints.view": ["عرض السبرنتات", "عرض السبرنتات"],
  "sprints.manage": ["إدارة السبرنتات", "إنشاء السبرنتات وتحديثها وإكمالها"],
};

export function permissionName(permission: AuthorizationPermission, ctx: Pick<ViewCtx, "locale">) {
  return ctx.locale === "ar" ? (permissionLabels[permission.key]?.[0] ?? permission.name) : permission.name;
}

export function permissionDescription(permission: AuthorizationPermission, ctx: Pick<ViewCtx, "locale">) {
  return ctx.locale === "ar"
    ? (permissionLabels[permission.key]?.[1] ?? permission.description)
    : permission.description;
}

function categoryLabel(category: string, ctx: ViewCtx) {
  const label = categoryLabels[category];
  return label ? ctx.t(label[0], label[1]) : category;
}

function scopeLabel(scope: AuthorizationScopeName, ctx: ViewCtx) {
  if (scope === "organization") return ctx.t("المؤسسة", "Organization");
  if (scope === "workspace") return ctx.t("مساحة العمل", "Workspace");
  return ctx.t("المشروع", "Project");
}

function roleLabel(role: AuthorizationRole, ctx: ViewCtx) {
  const system: Record<string, [string, string]> = {
    owner: ["المالك", "Owner"],
    admin: ["المسؤول", "Admin"],
    manager: ["المدير", "Manager"],
    member: ["العضو", "Member"],
    guest: ["الضيف", "Guest"],
    viewer: ["المشاهد", "Viewer"],
  };
  const translated = role.isSystem ? system[role.key] : undefined;
  return translated ? ctx.t(translated[0], translated[1]) : role.name;
}

function roleDescription(role: AuthorizationRole, ctx: ViewCtx) {
  const system: Record<string, [string, string]> = {
    owner: [
      "تحكم كامل في المؤسسة، بما في ذلك العمليات الحساسة المرتبطة بالملكية",
      "Full organization control including ownership-sensitive operations",
    ],
    admin: ["وصول إداري باستثناء العمليات المخصصة للمالك", "Administrative access excluding owner-only operations"],
    manager: [
      "إدارة مساحات العمل والمشاريع والمهام والأتمتة والتقارير",
      "Workspace, project, task, automation, and reporting management",
    ],
    member: ["وصول قياسي للمساهمة في المشاريع والمهام", "Standard project and task contribution access"],
    guest: [
      "وصول محدود للمساهمة في الموارد المعيّنة صراحةً",
      "Limited contribution access to explicitly assigned resources",
    ],
    viewer: ["وصول للقراءة فقط إلى الموارد الظاهرة صراحةً", "Read-only access to explicitly visible resources"],
  };
  const translated = role.isSystem ? system[role.key] : undefined;
  return translated ? ctx.t(translated[0], translated[1]) : role.description;
}

function bindingRoleLabel(binding: AuthorizationBinding, ctx: ViewCtx) {
  if (!binding.roleIsSystem) return binding.roleName;
  return roleLabel(
    {
      id: binding.roleId,
      organizationId: null,
      key: binding.roleKey,
      name: binding.roleName,
      description: null,
      isSystem: true,
      assignmentCount: 0,
      permissionKeys: [],
      createdAt: binding.createdAt,
      updatedAt: binding.createdAt,
    },
    ctx,
  );
}

function permissionGroups(permissions: AuthorizationPermission[]) {
  const groups = new Map<string, AuthorizationPermission[]>();
  for (const permission of permissions) {
    groups.set(permission.category, [...(groups.get(permission.category) ?? []), permission]);
  }
  return [...groups.entries()];
}

export function PermissionsView({ ctx }: { ctx: ViewCtx }) {
  const [catalog, setCatalog] = useState<AuthorizationCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("roles");
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [archivingRoleId, setArchivingRoleId] = useState("");
  const requestIdRef = useRef(0);
  const roleMutationRef = useRef(false);
  const organizationId = ctx.activeOrg?.id;
  const canManage = ctx.can("organization.manage");

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!organizationId || !canManage) {
      setLoading(false);
      setCatalog(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextCatalog = await getAuthorizationCatalog(organizationId);
      if (requestId !== requestIdRef.current) return;
      setCatalog(nextCatalog);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setCatalog(null);
      setError(
        ctx.locale === "ar"
          ? "تعذر تحميل مركز الصلاحيات. تحقق من الاتصال ثم حاول مجدداً."
          : "The permissions center could not be loaded. Check your connection and try again.",
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [canManage, ctx.locale, organizationId]);

  useEffect(() => {
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [load]);

  if (!canManage) {
    return (
      <Card className="mx-auto max-w-xl p-8">
        <Empty
          icon={<IconShield size={24} />}
          title={ctx.t("إدارة الصلاحيات محمية", "Permissions management is protected")}
          hint={ctx.t(
            "تحتاج إلى صلاحية إدارة المؤسسة لعرض الأدوار وتعديلها.",
            "Organization management permission is required to view and change roles.",
          )}
        />
      </Card>
    );
  }

  if (!organizationId) {
    return (
      <ScreenState
        icon={<IconShield size={20} />}
        title={ctx.t("اختر مؤسسة لإدارة صلاحياتها", "Select an organization to manage its permissions")}
        description={ctx.t(
          "لا يمكن تحميل الأدوار والتعيينات دون سياق مؤسسة نشط.",
          "Roles and assignments cannot be loaded without an active organization context.",
        )}
      />
    );
  }

  const saveRole = async () => {
    if (roleMutationRef.current || !organizationId || !roleDraft || !roleDraft.name.trim()) return;
    if (!roleDraft.id && !/^[a-z][a-z0-9_-]{2,99}$/.test(roleDraft.key)) {
      ctx.notify(
        ctx.t(
          "يجب أن يبدأ مفتاح الدور بحرف إنجليزي ويحتوي أحرفاً وأرقاماً وشرطة فقط.",
          "Role key must start with a letter and contain only letters, numbers, hyphens, or underscores.",
        ),
        "error",
      );
      return;
    }
    roleMutationRef.current = true;
    setSavingRole(true);
    try {
      if (roleDraft.id) {
        await updateAuthorizationRole(roleDraft.id, {
          organizationId,
          name: roleDraft.name.trim(),
          description: roleDraft.description.trim() || null,
          permissionKeys: roleDraft.permissionKeys,
        });
        ctx.notify(ctx.t("تم تحديث الدور وصلاحياته.", "Role and permissions updated."));
      } else {
        await createAuthorizationRole({
          organizationId,
          key: roleDraft.key.trim().toLowerCase(),
          name: roleDraft.name.trim(),
          description: roleDraft.description.trim() || null,
          permissionKeys: roleDraft.permissionKeys,
        });
        ctx.notify(ctx.t("تم إنشاء الدور المخصص.", "Custom role created."));
      }
      setRoleDraft(null);
      await load();
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر حفظ الدور. لم تُعتمد تغييرات الصلاحيات.",
          "The role could not be saved. Permission changes were not applied.",
        ),
        "error",
      );
    } finally {
      roleMutationRef.current = false;
      setSavingRole(false);
    }
  };

  const archiveRole = async (role: AuthorizationRole) => {
    if (roleMutationRef.current || !organizationId) return;
    if (role.assignmentCount > 0) {
      ctx.notify(
        ctx.t(
          `الدور مستخدم في ${fmtNumber(role.assignmentCount, ctx.locale)} تعيين. أزل التعيينات أولاً.`,
          `This role has ${fmtNumber(role.assignmentCount, ctx.locale)} assignment(s). Remove them first.`,
        ),
        "warning",
      );
      return;
    }
    const confirmed = await confirmAction({
      title: ctx.t("أرشفة الدور المخصص", "Archive custom role"),
      message: ctx.t(
        `سيُخفى الدور «${role.name}» ولن يمكن تعيينه مجدداً.`,
        `“${role.name}” will be hidden and can no longer be assigned.`,
      ),
      confirmLabel: ctx.t("أرشفة الدور", "Archive role"),
      tone: "warning",
    });
    if (!confirmed) return;
    roleMutationRef.current = true;
    setArchivingRoleId(role.id);
    try {
      await archiveAuthorizationRole(role.id, organizationId);
      ctx.notify(ctx.t("تمت أرشفة الدور.", "Role archived."));
      await load();
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر أرشفة الدور. لم تتغير قائمة الأدوار.",
          "The role could not be archived. The role list was unchanged.",
        ),
        "error",
      );
    } finally {
      roleMutationRef.current = false;
      setArchivingRoleId("");
    }
  };

  return (
    <div className="screen-container-wide space-y-5 animate-fade">
      <ScreenHeader
        title={ctx.t("الأدوار والصلاحيات", "Roles & permissions")}
        description={ctx.t(
          "أدر الوصول الفعلي على مستوى المؤسسة ومساحات العمل والمشاريع.",
          "Manage effective access across the organization, workspaces, and projects.",
        )}
        icon={<IconShield size={19} />}
        actions={
          catalog ? (
            <>
              <Badge tone="indigo">
                {fmtNumber(catalog.roles.length, ctx.locale)} {ctx.t("أدوار", "roles")}
              </Badge>
              <Badge tone="violet">
                {fmtNumber(catalog.permissions.length, ctx.locale)} {ctx.t("صلاحية", "permissions")}
              </Badge>
              <Badge tone="cyan">
                {fmtNumber(catalog.bindings.length, ctx.locale)} {ctx.t("تعيين", "assignments")}
              </Badge>
            </>
          ) : undefined
        }
        className="mb-0"
      />

      <SegmentedTabs
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        label={ctx.t("أقسام إدارة الصلاحيات", "Permission management sections")}
        items={[
          { value: "roles", label: ctx.t("مصفوفة الأدوار", "Role matrix"), icon: <IconShield size={14} /> },
          { value: "members", label: ctx.t("وصول الأعضاء", "Member access"), icon: <IconUsers size={14} /> },
        ]}
        stretch
        className="sm:w-fit"
      />

      {loading ? (
        <ScreenState tone="loading" title={ctx.t("جارٍ تحميل الصلاحيات…", "Loading permissions…")} />
      ) : error ? (
        <ScreenState
          tone="error"
          icon={<IconShield size={20} />}
          title={ctx.t("تعذر تحميل الصلاحيات", "Failed to load permissions")}
          description={error}
          action={<Btn onClick={() => void load()}>{ctx.t("إعادة المحاولة", "Try again")}</Btn>}
        />
      ) : catalog ? (
        tab === "roles" ? (
          <RoleMatrix
            ctx={ctx}
            catalog={catalog}
            onCreate={() => setRoleDraft(newRoleDraft())}
            onEdit={(role) =>
              setRoleDraft({
                id: role.id,
                key: role.key,
                name: role.name,
                description: role.description ?? "",
                permissionKeys: [...role.permissionKeys],
              })
            }
            onArchive={(role) => void archiveRole(role)}
            pendingRoleId={archivingRoleId}
          />
        ) : (
          <MemberAccess ctx={ctx} catalog={catalog} reload={load} />
        )
      ) : null}

      <RoleEditor
        ctx={ctx}
        catalog={catalog}
        draft={roleDraft}
        setDraft={setRoleDraft}
        saving={savingRole}
        onSave={() => void saveRole()}
      />
    </div>
  );
}

function RoleMatrix({
  ctx,
  catalog,
  onCreate,
  onEdit,
  onArchive,
  pendingRoleId,
}: {
  ctx: ViewCtx;
  catalog: AuthorizationCatalog;
  onCreate: () => void;
  onEdit: (role: AuthorizationRole) => void;
  onArchive: (role: AuthorizationRole) => void;
  pendingRoleId: string;
}) {
  const [search, setSearch] = useState("");
  const [mobileRoleId, setMobileRoleId] = useState(catalog.roles[0]?.id ?? "");
  const visiblePermissions = catalog.permissions.filter((permission) =>
    `${permission.key} ${permission.name} ${permission.description ?? ""} ${permissionName(permission, ctx)} ${permissionDescription(permission, ctx) ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const mobileRole = catalog.roles.find((role) => role.id === mobileRoleId) ?? catalog.roles[0];
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="relative w-full min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">{ctx.t("البحث في الصلاحيات", "Search permissions")}</span>
            <IconSearch className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={ctx.t("ابحث بالمفتاح أو الوصف…", "Search by key or description…")}
              className={cn(inputCls, "ps-9")}
            />
          </label>
          <Btn variant="glow" disabled={Boolean(pendingRoleId)} onClick={onCreate}>
            <IconPlus size={14} /> {ctx.t("دور مخصص جديد", "New custom role")}
          </Btn>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="p-3 md:hidden">
          <label className="block text-[11px] font-semibold text-ink-soft">
            {ctx.t("الدور المعروض", "Displayed role")}
            <select
              value={mobileRole?.id ?? ""}
              onChange={(event) => setMobileRoleId(event.target.value)}
              className={`${selectCls} mt-1.5`}
            >
              {catalog.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {roleLabel(role, ctx)}
                </option>
              ))}
            </select>
          </label>
          {mobileRole && (
            <div className="mt-4 space-y-4">
              {permissionGroups(visiblePermissions).map(([category, permissions]) => (
                <section key={category} aria-labelledby={`mobile-permission-${category}`}>
                  <h3
                    id={`mobile-permission-${category}`}
                    className="mb-1.5 rounded-lg bg-indigo-50/70 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:bg-indigo-400/5 dark:text-indigo-300"
                  >
                    {categoryLabel(category, ctx)}
                  </h3>
                  <div className="divide-y divide-line rounded-xl border border-line">
                    {permissions.map((permission) => {
                      const granted = mobileRole.permissionKeys.includes(permission.key);
                      return (
                        <div key={permission.id} className="flex items-start gap-3 p-3">
                          <span
                            role="img"
                            aria-label={granted ? ctx.t("ممنوحة", "Granted") : ctx.t("غير ممنوحة", "Not granted")}
                            className={cn(
                              "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                              granted
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"
                                : "bg-raised text-ink-faint/50",
                            )}
                          >
                            {granted ? <IconCheck size={13} /> : <span aria-hidden="true">—</span>}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-semibold text-ink">{permissionName(permission, ctx)}</p>
                            {permissionDescription(permission, ctx) && (
                              <p className="mt-0.5 text-[10.5px] leading-4 text-ink-faint">
                                {permissionDescription(permission, ctx)}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        <div className="hidden overflow-x-auto overscroll-x-contain md:block">
          <table className="w-full min-w-[900px] border-collapse text-start">
            <thead className="sticky top-0 z-10 bg-raised/95 backdrop-blur">
              <tr>
                <th className="sticky start-0 z-20 min-w-[260px] border-b border-e border-line bg-raised px-4 py-3 text-start text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                  {ctx.t("الصلاحية", "Permission")}
                </th>
                {catalog.roles.map((role) => (
                  <th key={role.id} className="min-w-[130px] border-b border-line px-3 py-3 text-center align-top">
                    <div className="text-[12px] font-bold text-ink">{roleLabel(role, ctx)}</div>
                    {ctx.locale !== "ar" && (
                      <div className="mt-0.5 font-mono text-[9.5px] text-ink-faint">{role.key}</div>
                    )}
                    <Badge tone={role.isSystem ? "neutral" : "violet"} className="mt-1.5">
                      {role.isSystem ? ctx.t("نظامي", "System") : ctx.t("مخصص", "Custom")}
                    </Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissionGroups(visiblePermissions).map(([category, permissions]) => (
                <CategoryRows
                  key={category}
                  category={category}
                  permissions={permissions}
                  roles={catalog.roles}
                  ctx={ctx}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {catalog.roles.map((role) => (
          <Card key={role.id} className="p-4">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  role.isSystem
                    ? "bg-slate-100 text-slate-500 dark:bg-white/6"
                    : "bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300",
                )}
              >
                <IconShield size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[13px] font-bold text-ink">{roleLabel(role, ctx)}</h3>
                  {!role.isSystem && <Badge tone="violet">{ctx.t("مخصص", "Custom")}</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 min-h-9 text-[11.5px] leading-4.5 text-ink-soft">
                  {roleDescription(role, ctx) || ctx.t("لا يوجد وصف.", "No description.")}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <span className="text-[10.5px] text-ink-faint">
                {fmtNumber(role.permissionKeys.length, ctx.locale)} {ctx.t("صلاحية", "permissions")} ·{" "}
                {fmtNumber(role.assignmentCount, ctx.locale)} {ctx.t("تعيين", "assignments")}
              </span>
              {!role.isSystem && (
                <div className="flex gap-1">
                  <Btn size="sm" variant="ghost" disabled={Boolean(pendingRoleId)} onClick={() => onEdit(role)}>
                    {ctx.t("تعديل", "Edit")}
                  </Btn>
                  <button
                    type="button"
                    disabled={Boolean(pendingRoleId)}
                    aria-busy={pendingRoleId === role.id}
                    onClick={() => onArchive(role)}
                    aria-label={ctx.t(`أرشفة ${role.name}`, `Archive ${role.name}`)}
                    className="grid min-h-10 min-w-10 place-items-center rounded-lg text-rose-500 transition hover:bg-rose-500/10 focus-ring disabled:opacity-50"
                  >
                    <IconTrash size={13} />
                  </button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CategoryRows({
  category,
  permissions,
  roles,
  ctx,
}: {
  category: string;
  permissions: AuthorizationPermission[];
  roles: AuthorizationRole[];
  ctx: ViewCtx;
}) {
  return (
    <>
      <tr>
        <th
          colSpan={roles.length + 1}
          className="bg-indigo-50/60 px-4 py-2 text-start text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-600 dark:bg-indigo-400/5 dark:text-indigo-300"
        >
          {categoryLabel(category, ctx)}
        </th>
      </tr>
      {permissions.map((permission) => (
        <tr key={permission.id} className="group hover:bg-indigo-50/25 dark:hover:bg-indigo-400/3">
          <th className="sticky start-0 z-5 border-e border-b border-line bg-surface px-4 py-3 text-start group-hover:bg-indigo-50 dark:group-hover:bg-[#171721]">
            <div className="text-[11.5px] font-semibold text-ink">{permissionName(permission, ctx)}</div>
            {ctx.locale !== "ar" && (
              <div className="mt-0.5 font-mono text-[9.5px] text-indigo-500 dark:text-indigo-300">{permission.key}</div>
            )}
            {permissionDescription(permission, ctx) && (
              <div className="mt-1 max-w-[330px] text-[10px] font-normal leading-4 text-ink-faint">
                {permissionDescription(permission, ctx)}
              </div>
            )}
          </th>
          {roles.map((role) => {
            const granted = role.permissionKeys.includes(permission.key);
            return (
              <td key={role.id} className="border-b border-line px-3 py-3 text-center">
                <span
                  role="img"
                  aria-label={granted ? ctx.t("ممنوحة", "Granted") : ctx.t("غير ممنوحة", "Not granted")}
                  className={cn(
                    "mx-auto grid h-6 w-6 place-items-center rounded-lg",
                    granted
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"
                      : "bg-raised text-ink-faint/40",
                  )}
                >
                  {granted ? <IconCheck size={12} /> : <span className="text-[12px]">—</span>}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

function RoleEditor({
  ctx,
  catalog,
  draft,
  setDraft,
  saving,
  onSave,
}: {
  ctx: ViewCtx;
  catalog: AuthorizationCatalog | null;
  draft: RoleDraft | null;
  setDraft: (draft: RoleDraft | null) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const [permissionSearch, setPermissionSearch] = useState("");
  if (!draft || !catalog) return null;
  const visible = catalog.permissions.filter((permission) =>
    `${permission.key} ${permission.name} ${permission.description ?? ""} ${permissionName(permission, ctx)} ${permissionDescription(permission, ctx) ?? ""}`
      .toLowerCase()
      .includes(permissionSearch.toLowerCase()),
  );
  const toggle = (key: string) =>
    setDraft({
      ...draft,
      permissionKeys: draft.permissionKeys.includes(key)
        ? draft.permissionKeys.filter((item) => item !== key)
        : [...draft.permissionKeys, key],
    });
  return (
    <Modal
      open
      onClose={saving ? () => undefined : () => setDraft(null)}
      title={draft.id ? ctx.t("تعديل الدور المخصص", "Edit custom role") : ctx.t("إنشاء دور مخصص", "Create custom role")}
      icon={<IconShield size={16} />}
      size="large"
      closeLabel={ctx.t("إغلاق نافذة الدور", "Close role dialog")}
      panelStyle={{
        width: "min(760px, calc(100vw - 1rem))",
        height: "min(640px, calc(100dvh - 1rem))",
        maxWidth: "calc(100vw - 1rem)",
        maxHeight: "calc(100dvh - 1rem)",
      }}
      contentClassName="flex overflow-hidden p-0 sm:p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden">
          <div className="space-y-4 border-b border-line p-4 sm:p-5 lg:overflow-y-auto lg:border-b-0 lg:border-e">
            <div>
              <h4 className="text-[13px] font-bold text-ink">{ctx.t("بيانات الدور", "Role details")}</h4>
              <p className="mt-1 text-[11px] leading-5 text-ink-faint">
                {ctx.t(
                  "استخدم اسماً واضحاً يصف مسؤولية هذا الدور داخل المؤسسة.",
                  "Use a clear name that describes this role's responsibility in the organization.",
                )}
              </p>
            </div>
            <Field label={ctx.t("اسم الدور", "Role name")}>
              <input
                value={draft.name}
                disabled={saving}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={inputCls}
                placeholder={ctx.t("مثال: مدير المحتوى", "Example: Content manager")}
              />
            </Field>
            <Field label={ctx.t("الوصف", "Description")}>
              <textarea
                value={draft.description}
                disabled={saving}
                maxLength={500}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className={cn(areaCls, "min-h-28")}
                placeholder={ctx.t("اشرح مسؤوليات هذا الدور…", "Describe this role's responsibilities…")}
              />
            </Field>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3.5 dark:border-indigo-400/15 dark:bg-indigo-400/7">
              <div className="flex items-center gap-2 text-[11.5px] font-semibold text-indigo-700 dark:text-indigo-200">
                <IconShield size={13} />
                {fmtNumber(draft.permissionKeys.length, ctx.locale)} {ctx.t("صلاحية محددة", "permissions selected")}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-4.5 text-indigo-700/70 dark:text-indigo-200/65">
                {ctx.t(
                  "يمكن تعديل صلاحيات الدور لاحقاً، وتُطبق التغييرات على جميع تعييناته.",
                  "The role can be updated later; changes apply to all of its assignments.",
                )}
              </p>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col p-4 sm:p-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[13px] font-bold text-ink">{ctx.t("اختيار الصلاحيات", "Select permissions")}</div>
                <div className="mt-1 text-[10.5px] text-ink-faint">
                  {fmtNumber(visible.length, ctx.locale)} {ctx.t("نتيجة ظاهرة", "visible results")} ·{" "}
                  {fmtNumber(draft.permissionKeys.length, ctx.locale)} {ctx.t("محددة", "selected")}
                </div>
              </div>
              <label className="relative w-full sm:w-64">
                <IconSearch size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  aria-label={ctx.t("البحث في صلاحيات الدور", "Search role permissions")}
                  value={permissionSearch}
                  disabled={saving}
                  onChange={(event) => setPermissionSearch(event.target.value)}
                  className={cn(inputCls, "h-9 ps-8")}
                  placeholder={ctx.t("بحث…", "Search…")}
                />
              </label>
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || visible.length === 0}
                onClick={() =>
                  setDraft({
                    ...draft,
                    permissionKeys: [...new Set([...draft.permissionKeys, ...visible.map((item) => item.key)])],
                  })
                }
                className="min-h-10 rounded-lg border border-line bg-surface px-2.5 text-[10.5px] font-semibold text-ink-soft transition hover:border-accent/40 hover:text-accent focus-ring disabled:opacity-50"
              >
                {ctx.t("تحديد النتائج الظاهرة", "Select visible")}
              </button>
              <button
                type="button"
                disabled={saving || draft.permissionKeys.length === 0}
                onClick={() => setDraft({ ...draft, permissionKeys: [] })}
                className="min-h-10 rounded-lg px-2.5 text-[10.5px] font-semibold text-ink-faint transition hover:bg-raised hover:text-ink focus-ring disabled:pointer-events-none disabled:opacity-40"
              >
                {ctx.t("مسح التحديد", "Clear selection")}
              </button>
            </div>
            <div className="min-h-64 flex-1 space-y-4 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-raised/45 p-3 pe-2 lg:min-h-0">
              {visible.length ? (
                permissionGroups(visible).map(([category, permissions]) => (
                  <section key={category}>
                    <div className="sticky top-0 z-2 mb-1.5 rounded-lg bg-raised/95 px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-500 backdrop-blur dark:text-indigo-300">
                      {categoryLabel(category, ctx)}
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {permissions.map((permission) => {
                        const checked = draft.permissionKeys.includes(permission.key);
                        return (
                          <button
                            key={permission.id}
                            type="button"
                            disabled={saving}
                            aria-pressed={checked}
                            onClick={() => toggle(permission.key)}
                            className={cn(
                              "flex min-h-14 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60",
                              checked
                                ? "border-indigo-200 bg-indigo-50 text-indigo-950 shadow-sm dark:border-indigo-400/25 dark:bg-indigo-400/10 dark:text-indigo-100"
                                : "border-transparent bg-surface text-ink-soft hover:border-line hover:bg-surface/80",
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition",
                                checked ? "border-indigo-500 bg-indigo-500 text-white" : "border-line bg-raised",
                              )}
                            >
                              {checked && <IconCheck size={10} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-[11px] font-semibold leading-4">
                                {permissionName(permission, ctx)}
                              </span>
                              {ctx.locale !== "ar" && (
                                <span className="mt-0.5 block truncate font-mono text-[9px] opacity-60" dir="ltr">
                                  {permission.key}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ))
              ) : (
                <div className="grid min-h-44 place-items-center px-4 text-center">
                  <div>
                    <IconSearch size={20} className="mx-auto text-ink-faint" />
                    <p className="mt-2 text-[11.5px] font-semibold text-ink-soft">
                      {ctx.t("لا توجد صلاحيات مطابقة", "No matching permissions")}
                    </p>
                    <p className="mt-1 text-[10.5px] text-ink-faint">
                      {ctx.t("جرّب كلمة بحث مختلفة.", "Try a different search term.")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-line bg-surface px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
          <Btn disabled={saving} onClick={() => setDraft(null)}>
            {ctx.t("إلغاء", "Cancel")}
          </Btn>
          <Btn variant="glow" disabled={saving || !draft.name.trim()} onClick={onSave} className="sm:min-w-32">
            {saving ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("حفظ الدور", "Save role")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function MemberAccess({
  ctx,
  catalog,
  reload,
}: {
  ctx: ViewCtx;
  catalog: AuthorizationCatalog;
  reload: () => Promise<void>;
}) {
  const members = useMemo(() => memberDirectory(catalog), [catalog]);
  const [selectedMembershipId, setSelectedMembershipId] = useState(members[0]?.membershipId ?? "");
  const selectedMember = members.find((member) => member.membershipId === selectedMembershipId) ?? members[0];
  const [scopeName, setScopeName] = useState<AuthorizationScopeName>(
    selectedMember?.membershipWorkspaceId ? "workspace" : "organization",
  );
  const [workspaceId, setWorkspaceId] = useState(
    selectedMember?.membershipWorkspaceId ?? ctx.activeWorkspace?.id ?? "",
  );
  const [projectId, setProjectId] = useState(ctx.activeProject?.id ?? "");
  const [roleId, setRoleId] = useState(catalog.roles[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef("");
  const [overrideReason, setOverrideReason] = useState("");

  useEffect(() => {
    if (!selectedMember) return;
    if (selectedMember.membershipWorkspaceId) {
      setScopeName("workspace");
      setWorkspaceId(selectedMember.membershipWorkspaceId);
    }
  }, [selectedMember]);

  if (!selectedMember)
    return (
      <Card>
        <Empty icon={<IconUsers size={22} />} title={ctx.t("لا يوجد أعضاء نشطون", "No active members")} />
      </Card>
    );

  const availableWorkspaces = selectedMember.membershipWorkspaceId
    ? ctx.workspaces.filter((workspace) => workspace.id === selectedMember.membershipWorkspaceId)
    : ctx.workspaces;
  const availableProjects = ctx.projects.filter((project) => project.workspaceId === workspaceId);
  const scope: PermissionScope = {
    organizationId: ctx.activeOrg!.id,
    ...(scopeName !== "organization" ? { workspaceId } : {}),
    ...(scopeName === "project" ? { projectId } : {}),
  };
  const effective = new Set(effectivePermissionKeys(catalog, selectedMember.membershipId, scope));
  const memberBindings = catalog.bindings.filter((binding) => binding.membershipId === selectedMember.membershipId);
  const exactBindings = memberBindings.filter((binding) => exactScopeMatch(binding, scopeName, scope));
  const roleAlreadyAssigned = exactBindings.some((binding) => binding.roleId === roleId);
  const canEditMember = selectedMember.userId !== ctx.currentUser?.id;
  const visiblePermissions = catalog.permissions.filter((permission) =>
    `${permission.key} ${permission.name} ${permission.description ?? ""} ${permissionName(permission, ctx)} ${permissionDescription(permission, ctx) ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const assign = async () => {
    if (
      busyRef.current ||
      !canEditMember ||
      !roleId ||
      (scopeName !== "organization" && !workspaceId) ||
      (scopeName === "project" && !projectId)
    )
      return;
    if (roleAlreadyAssigned) {
      ctx.notify(
        ctx.t("هذا الدور معيّن بالفعل في النطاق المحدد.", "This role is already assigned in the selected scope."),
        "warning",
      );
      return;
    }
    busyRef.current = "assign";
    setBusy("assign");
    try {
      await assignAuthorizationRole({
        organizationId: ctx.activeOrg!.id,
        membershipId: selectedMember.membershipId,
        roleId,
        scope: scopeName,
        ...(scopeName !== "organization" ? { workspaceId } : {}),
        ...(scopeName === "project" ? { projectId } : {}),
      });
      ctx.notify(ctx.t("تم تعيين الدور في النطاق المحدد.", "Role assigned in the selected scope."));
      await reload();
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر تعيين الدور. لم تتغير صلاحيات العضو.",
          "The role could not be assigned. Member access was unchanged.",
        ),
        "error",
      );
    } finally {
      busyRef.current = "";
      setBusy("");
    }
  };

  const removeBinding = async (binding: AuthorizationBinding) => {
    const confirmed = await confirmAction({
      title: ctx.t("إزالة تعيين الدور", "Remove role assignment"),
      message: ctx.t(
        `ستُزال صلاحيات «${bindingRoleLabel(binding, ctx)}» الممنوحة من هذا النطاق.`,
        `Permissions granted by “${binding.roleName}” in this scope will be removed.`,
      ),
      confirmLabel: ctx.t("إزالة التعيين", "Remove assignment"),
      tone: "warning",
    });
    if (!confirmed) return;
    if (busyRef.current) return;
    busyRef.current = binding.id;
    setBusy(binding.id);
    try {
      await removeAuthorizationBinding(binding.id, ctx.activeOrg!.id);
      ctx.notify(ctx.t("تمت إزالة تعيين الدور.", "Role assignment removed."));
      await reload();
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر إزالة التعيين. لم تتغير صلاحيات العضو.",
          "The assignment could not be removed. Member access was unchanged.",
        ),
        "error",
      );
    } finally {
      busyRef.current = "";
      setBusy("");
    }
  };

  const exactOverride = (permissionKey: string) =>
    catalog.overrides.find(
      (override) =>
        override.membershipId === selectedMember.membershipId &&
        override.permissionKey === permissionKey &&
        exactScopeMatch(override, scopeName, scope),
    );

  const changeOverride = async (permission: AuthorizationPermission, effect: PermissionOverrideEffect | "inherit") => {
    if (!canEditMember || busyRef.current) return;
    if (effect !== "inherit" && !overrideReason.trim()) {
      ctx.notify(
        ctx.t(
          "اكتب سبباً واضحاً قبل إضافة سماح أو منع مباشر.",
          "Provide a clear reason before adding a direct allow or deny override.",
        ),
        "warning",
      );
      return;
    }
    const current = exactOverride(permission.key);
    busyRef.current = `override:${permission.key}`;
    setBusy(`override:${permission.key}`);
    try {
      if (effect === "inherit") {
        if (current) await removeAuthorizationOverride(current.id, ctx.activeOrg!.id);
      } else {
        await setAuthorizationOverride({
          organizationId: ctx.activeOrg!.id,
          membershipId: selectedMember.membershipId,
          permissionKey: permission.key,
          effect,
          reason: overrideReason.trim() || null,
          scope: scopeName,
          ...(scopeName !== "organization" ? { workspaceId } : {}),
          ...(scopeName === "project" ? { projectId } : {}),
        });
      }
      ctx.notify(ctx.t("تم تحديث استثناء الصلاحية.", "Permission override updated."));
      await reload();
    } catch {
      ctx.notify(
        ctx.t(
          "تعذر تحديث الاستثناء. بقي الوصول السابق كما هو.",
          "The override could not be updated. Previous access was kept.",
        ),
        "error",
      );
    } finally {
      busyRef.current = "";
      setBusy("");
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="h-fit p-3">
        <div className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
          {ctx.t("الأعضاء", "Members")}
        </div>
        <div className="max-h-[640px] space-y-1 overflow-y-auto">
          {members.map((member) => (
            <button
              key={member.membershipId}
              type="button"
              onClick={() => setSelectedMembershipId(member.membershipId)}
              disabled={Boolean(busy)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start transition",
                member.membershipId === selectedMember.membershipId
                  ? "bg-indigo-50 text-indigo-950 ring-1 ring-indigo-100 dark:bg-indigo-400/10 dark:text-white dark:ring-indigo-400/10"
                  : "hover:bg-raised",
              )}
            >
              <Avatar name={member.userName} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">{member.userName}</span>
                <span className="block truncate text-[10px] text-ink-faint" dir="ltr">
                  {member.userEmail}
                </span>
              </span>
              {member.userId === ctx.currentUser?.id && <Badge tone="indigo">{ctx.t("أنت", "You")}</Badge>}
            </button>
          ))}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Avatar name={selectedMember.userName} size={42} />
              <div>
                <h2 className="text-[15px] font-bold text-ink">{selectedMember.userName}</h2>
                <div className="text-[11px] text-ink-faint" dir="ltr">
                  {selectedMember.userEmail}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="indigo">
                {fmtNumber(effective.size, ctx.locale)} {ctx.t("صلاحية فعالة", "effective permissions")}
              </Badge>
              <Badge tone="neutral">
                {fmtNumber(memberBindings.length, ctx.locale)} {ctx.t("أدوار معينة", "assigned roles")}
              </Badge>
            </div>
          </div>
          {!canEditMember && (
            <div
              role="status"
              className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11.5px] text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/8 dark:text-amber-200"
            >
              {ctx.t(
                "لأمان الحساب لا يمكنك تغيير تعييناتك أو استثناءاتك بنفسك.",
                "For account safety, you cannot change your own assignments or overrides.",
              )}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-[13px] font-bold text-ink">{ctx.t("نطاق الإدارة", "Management scope")}</h3>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {ctx.t("اختر المكان الذي ينطبق فيه الدور أو الاستثناء.", "Choose where the role or override applies.")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={ctx.t("النطاق", "Scope")}>
              <select
                value={scopeName}
                disabled={Boolean(busy)}
                onChange={(event) => setScopeName(event.target.value as AuthorizationScopeName)}
                className={selectCls}
              >
                {!selectedMember.membershipWorkspaceId && (
                  <option value="organization">{ctx.t("المؤسسة كاملة", "Entire organization")}</option>
                )}
                <option value="workspace">{ctx.t("مساحة عمل", "Workspace")}</option>
                <option value="project">{ctx.t("مشروع", "Project")}</option>
              </select>
            </Field>
            {scopeName !== "organization" && (
              <Field label={ctx.t("مساحة العمل", "Workspace")}>
                <select
                  value={workspaceId}
                  disabled={Boolean(selectedMember.membershipWorkspaceId) || Boolean(busy)}
                  onChange={(event) => {
                    setWorkspaceId(event.target.value);
                    setProjectId("");
                  }}
                  className={selectCls}
                >
                  {availableWorkspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {scopeName === "project" && (
              <Field label={ctx.t("المشروع", "Project")}>
                <select
                  value={projectId}
                  disabled={Boolean(busy)}
                  onChange={(event) => setProjectId(event.target.value)}
                  className={selectCls}
                >
                  <option value="">{ctx.t("اختر مشروعاً", "Select project")}</option>
                  {availableProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={ctx.t("تعيين دور في هذا النطاق", "Assign role in this scope")}>
              <select
                value={roleId}
                disabled={Boolean(busy)}
                onChange={(event) => setRoleId(event.target.value)}
                className={cn(selectCls, "min-w-60")}
              >
                {catalog.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {roleLabel(role, ctx)} · {fmtNumber(role.permissionKeys.length, ctx.locale)}
                  </option>
                ))}
              </select>
            </Field>
            <Btn
              variant="glow"
              disabled={
                !canEditMember || roleAlreadyAssigned || Boolean(busy) || (scopeName === "project" && !projectId)
              }
              onClick={() => void assign()}
            >
              <IconPlus size={13} />{" "}
              {busy === "assign" ? ctx.t("جارٍ التعيين…", "Assigning…") : ctx.t("تعيين الدور", "Assign role")}
            </Btn>
          </div>
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-faint">
              {ctx.t("الأدوار في النطاق المحدد", "Roles in selected scope")}
            </div>
            {exactBindings.length ? (
              <div className="flex flex-wrap gap-2">
                {exactBindings.map((binding) => (
                  <span
                    key={binding.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-[11.5px] font-semibold text-ink"
                  >
                    <IconShield size={12} className="text-indigo-500" />
                    {bindingRoleLabel(binding, ctx)}
                    {binding.isPrimary ? (
                      <Badge tone="indigo">{ctx.t("أساسي", "Primary")}</Badge>
                    ) : (
                      <button
                        type="button"
                        disabled={!canEditMember || Boolean(busy)}
                        onClick={() => void removeBinding(binding)}
                        className="grid min-h-10 min-w-10 place-items-center rounded text-rose-500 hover:bg-rose-500/10 focus-ring disabled:opacity-50"
                        aria-label={ctx.t("إزالة الدور", "Remove role")}
                      >
                        <IconX size={11} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11.5px] text-ink-faint">
                {ctx.t(
                  "لا توجد أدوار مباشرة في هذا النطاق؛ قد تكون الصلاحيات موروثة من نطاق أعلى.",
                  "No roles are assigned directly here; permissions may be inherited from a higher scope.",
                )}
              </div>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-line p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-bold text-ink">
                  {ctx.t("الصلاحيات الفعلية والاستثناءات", "Effective permissions & overrides")}
                </h3>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {ctx.t(
                    "استخدم المنح أو المنع المباشر للحالات الاستثنائية فقط.",
                    "Use direct allow or deny only for exceptional cases.",
                  )}
                </p>
              </div>
              <label className="relative w-60">
                <IconSearch size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  value={search}
                  disabled={Boolean(busy)}
                  onChange={(event) => setSearch(event.target.value)}
                  className={cn(inputCls, "h-9 ps-8")}
                  placeholder={ctx.t("بحث في الصلاحيات…", "Search permissions…")}
                />
              </label>
            </div>
            <input
              value={overrideReason}
              disabled={Boolean(busy)}
              onChange={(event) => setOverrideReason(event.target.value)}
              className={cn(inputCls, "mt-3 h-9")}
              placeholder={ctx.t("سبب الاستثناء (اختياري لكنه موصى به)", "Override reason (optional, but recommended)")}
            />
          </div>
          <div className="max-h-[620px] overflow-y-auto p-3">
            {permissionGroups(visiblePermissions).map(([category, permissions]) => (
              <section key={category} className="mb-4 last:mb-0">
                <div className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-indigo-500">
                  {categoryLabel(category, ctx)}
                </div>
                <div className="space-y-1">
                  {permissions.map((permission) => {
                    const current = exactOverride(permission.key);
                    const granted = effective.has(permission.key);
                    const waiting = busy === `override:${permission.key}`;
                    return (
                      <div
                        key={permission.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-raised"
                      >
                        <span
                          className={cn(
                            "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
                            granted
                              ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300"
                              : "bg-slate-100 text-slate-400 dark:bg-white/5",
                          )}
                        >
                          {granted ? <IconCheck size={12} /> : <IconX size={11} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11.5px] font-semibold text-ink">
                            {permissionName(permission, ctx)}
                          </span>
                          {ctx.locale !== "ar" && (
                            <span className="block truncate font-mono text-[9.5px] text-ink-faint">
                              {permission.key}
                            </span>
                          )}
                        </span>
                        <div className="flex rounded-lg border border-line bg-surface p-0.5">
                          {(["inherit", "allow", "deny"] as const).map((effect) => {
                            const protectedDeny = permission.key === "organization.manage" && effect === "deny";
                            return (
                              <button
                                key={effect}
                                type="button"
                                disabled={!canEditMember || Boolean(busy) || waiting || protectedDeny}
                                title={
                                  protectedDeny
                                    ? ctx.t(
                                        "لا يمكن منع صلاحية إدارة المؤسسة لحماية الوصول الإداري.",
                                        "Organization management cannot be denied to protect administrative access.",
                                      )
                                    : undefined
                                }
                                onClick={() => void changeOverride(permission, effect)}
                                className={cn(
                                  "min-h-10 rounded-md px-2.5 text-[10px] font-semibold transition focus-ring disabled:cursor-not-allowed disabled:opacity-45",
                                  (effect === "inherit" ? !current : current?.effect === effect)
                                    ? effect === "allow"
                                      ? "bg-emerald-500 text-white"
                                      : effect === "deny"
                                        ? "bg-rose-500 text-white"
                                        : "bg-raised text-ink"
                                    : "text-ink-faint hover:text-ink",
                                )}
                              >
                                {effect === "inherit"
                                  ? ctx.t("موروث", "Inherit")
                                  : effect === "allow"
                                    ? ctx.t("سماح", "Allow")
                                    : ctx.t("منع", "Deny")}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
