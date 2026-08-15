"use client";

import { useEffect, useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import {
  areaCls,
  Badge,
  Btn,
  Card,
  inputCls,
  ScreenHeader,
  ScreenState,
  SegmentedTabs,
  selectCls,
} from "@/components/ui";
import { confirmAction } from "@/components/feedback";
import { IconSettings, IconTrash } from "@/components/icons";
import {
  downloadPreparedWorkspaceExport,
  getOrganizationAuthorization,
  prepareOrganizationExport,
  prepareWorkspaceExport,
} from "@/features/workspace/export-api";
import type { WorkspaceExportFormat } from "@/features/workspace/export-api";
import { ScheduledReportsPanel } from "./scheduled-reports-panel";
import { OrganizationLifecycleCard } from "@/features/data-lifecycle/lifecycle-cards";

function exportStatusLabel(status: string, t: ViewCtx["t"]) {
  switch (status) {
    case "pending":
      return t("قيد الانتظار", "Pending");
    case "processing":
      return t("جارٍ المعالجة", "Processing");
    case "completed":
      return t("مكتمل", "Completed");
    case "failed":
      return t("فشل التصدير", "Failed");
    default:
      return status;
  }
}

export function SettingsView({ ctx }: { ctx: ViewCtx }) {
  const [tab, setTab] = useState<"general" | "fields" | "data">("general");
  const [name, setName] = useState(ctx.activeWorkspace?.name || "");
  const [description, setDescription] = useState(ctx.activeWorkspace?.description || "");
  const [color, setColor] = useState(ctx.activeWorkspace?.color || "#6366f1");
  const [savingGeneral, setSavingGeneral] = useState(false);

  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("short_text");
  const [fieldDescription, setFieldDescription] = useState("");

  const [exporting, setExporting] = useState<WorkspaceExportFormat | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [organizationExporting, setOrganizationExporting] = useState(false);
  const [organizationExportAllowed, setOrganizationExportAllowed] = useState(false);
  const [organizationAuthorizationLoading, setOrganizationAuthorizationLoading] = useState(false);
  const [organizationAuthorizationError, setOrganizationAuthorizationError] = useState<string | null>(null);
  const [organizationAuthorizationKey, setOrganizationAuthorizationKey] = useState(0);

  useEffect(() => {
    setName(ctx.activeWorkspace?.name || "");
    setDescription(ctx.activeWorkspace?.description || "");
    setColor(ctx.activeWorkspace?.color || "#6366f1");
  }, [ctx.activeWorkspace]);

  const organizationId = ctx.activeOrg?.id;
  const t = ctx.t;

  useEffect(() => {
    if (!organizationId || tab !== "data") {
      setOrganizationExportAllowed(false);
      setOrganizationAuthorizationLoading(false);
      setOrganizationAuthorizationError(null);
      return;
    }
    let active = true;
    setOrganizationAuthorizationLoading(true);
    setOrganizationAuthorizationError(null);
    void getOrganizationAuthorization({ organizationId })
      .then((authorization) => {
        if (active) {
          setOrganizationExportAllowed(authorization.permissions.includes("data.export"));
          setOrganizationAuthorizationLoading(false);
        }
      })
      .catch((error) => {
        if (active) {
          setOrganizationExportAllowed(false);
          setOrganizationAuthorizationError(
            error instanceof Error
              ? error.message
              : t("تعذر التحقق من صلاحيات التصدير", "Failed to check export permissions"),
          );
          setOrganizationAuthorizationLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId, tab, organizationAuthorizationKey, t]);

  const saveGeneral = async () => {
    setSavingGeneral(true);
    try {
      await ctx.updateWorkspace({ name: name.trim(), description, color });
    } finally {
      setSavingGeneral(false);
    }
  };

  const addField = () => {
    if (!fieldName.trim()) return;
    ctx.createCustomField({
      name: fieldName.trim(),
      type: fieldType,
      description: fieldDescription,
      required: false,
      sensitive: false,
    });
    setFieldName("");
    setFieldDescription("");
    setFieldType("short_text");
  };

  const deleteField = async (id: string, fieldName: string) => {
    const confirmed = await confirmAction({
      title: ctx.t("حذف الحقل المخصص", "Delete custom field"),
      message: ctx.t(`هل تريد بالتأكيد حذف الحقل "${fieldName}"؟`, `Are you sure you want to delete "${fieldName}"?`),
      tone: "danger",
    });
    if (!confirmed) return;
    ctx.deleteCustomField(id);
  };

  const exportWorkspace = async (format: WorkspaceExportFormat) => {
    if (!ctx.activeWorkspace || exporting) return;
    setExporting(format);
    ctx.notify(ctx.t("جارٍ تجهيز ملف التصدير على الخادم…", "Preparing server export…"));
    try {
      const download = await prepareWorkspaceExport(
        {
          organizationId: ctx.activeWorkspace.organizationId,
          workspaceId: ctx.activeWorkspace.id,
        },
        { format, onStatus: (job) => setExportStatus(job.status) },
      );
      downloadPreparedWorkspaceExport(download);
      ctx.notify(ctx.t("أصبح ملف التصدير جاهزاً للتنزيل", "Workspace export is ready to download"));
    } catch (error) {
      ctx.notify(
        error instanceof Error ? error.message : ctx.t("تعذر إنشاء ملف التصدير", "Could not create workspace export"),
        "error",
      );
    } finally {
      setExporting(null);
    }
  };

  const exportOrganization = async () => {
    if (!ctx.activeOrg || organizationExporting || !organizationExportAllowed) return;
    setOrganizationExporting(true);
    ctx.notify(ctx.t("جارٍ تجهيز أرشيف المؤسسة على الخادم…", "Preparing organization archive…"));
    try {
      const download = await prepareOrganizationExport(
        { organizationId: ctx.activeOrg.id },
        { onStatus: (job) => setExportStatus(job.status) },
      );
      downloadPreparedWorkspaceExport(download);
      ctx.notify(ctx.t("أصبح أرشيف المؤسسة جاهزاً للتنزيل", "Organization export is ready to download"));
    } catch (error) {
      ctx.notify(
        error instanceof Error
          ? error.message
          : ctx.t("تعذر إنشاء أرشيف المؤسسة", "Could not create organization export"),
        "error",
      );
    } finally {
      setOrganizationExporting(false);
    }
  };

  return (
    <div className="screen-container-standard space-y-6">
      <ScreenHeader
        title={ctx.t("إعدادات مساحة العمل", "Workspace Settings")}
        description={ctx.t(
          "إدارة هوية المساحة والحقول المخصصة ونقل البيانات",
          "Manage workspace identity, custom fields, and data portability",
        )}
      />

      <SegmentedTabs
        value={tab}
        onChange={(val) => setTab(val as "general" | "fields" | "data")}
        items={[
          { id: "general", label: ctx.t("عام", "General") },
          { id: "fields", label: ctx.t("الحقول المخصصة", "Custom Fields") },
          { id: "data", label: ctx.t("البيانات والتصدير", "Data & Export") },
        ]}
      />

      {tab === "general" && (
        <Card className="bg-surface p-6">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <IconSettings size={20} />
            </span>
            <div>
              <h3 className="font-bold text-ink">{ctx.t("معلومات مساحة العمل", "Workspace Identity")}</h3>
              <p className="text-[11.5px] text-ink-faint">{ctx.activeWorkspace?.slug}</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-ink-soft">
                {ctx.t("اسم المساحة", "Workspace name")}
              </span>
              <input
                name="auto-field-dd4f7j7"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-ink-soft">
                {ctx.t("اللون", "Brand color")}
              </span>
              <div className="flex items-center gap-3">
                <input
                  name="auto-field-hm6lu1q"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-14 rounded-lg border border-line bg-surface p-1"
                />
                <span className="mono text-[12px] text-ink-faint">{color}</span>
              </div>
            </label>
          </div>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-[11px] font-bold uppercase text-ink-soft">
              {ctx.t("الوصف", "Description")}
            </span>
            <textarea
              name="auto-field-q2f8shv"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={areaCls}
              placeholder={ctx.t("وصف يساعد الفريق على فهم نطاق المساحة...", "Describe the workspace scope...")}
            />
          </label>
          <div className="mt-5 flex justify-end">
            <Btn
              variant="glow"
              disabled={!ctx.can("workspace.manage") || savingGeneral}
              aria-busy={savingGeneral}
              onClick={saveGeneral}
            >
              {savingGeneral ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("حفظ الإعدادات", "Save settings")}
            </Btn>
          </div>
        </Card>
      )}

      {tab === "fields" && (
        <Card className="bg-surface p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink">{ctx.t("حقول المهام المخصصة", "Custom Task Fields")}</h3>
              <p className="text-[11.5px] text-ink-faint">
                {fmtNumber(ctx.customFields.length, ctx.locale)}{" "}
                {ctx.t("حقل مرتبط بهذه المساحة", "fields in this workspace")}
              </p>
            </div>
            <Badge tone="indigo">Workspace scoped</Badge>
          </div>
          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/10 p-4">
            <div className="grid items-end gap-3 md:grid-cols-[1fr_150px_1fr_auto]">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                  {ctx.t("اسم الحقل", "Field name")}
                </span>
                <input
                  name="auto-field-2nbyrnm"
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  placeholder={ctx.t("مثال: العميل، المرحلة...", "e.g. Client, Phase...")}
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                  {ctx.t("النوع", "Type")}
                </span>
                <select
                  name="auto-field-m7jo67c"
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value)}
                  className={selectCls}
                >
                  <option value="short_text">{ctx.t("نص", "Text")}</option>
                  <option value="number">{ctx.t("رقم", "Number")}</option>
                  <option value="date">{ctx.t("تاريخ", "Date")}</option>
                  <option value="single_select">{ctx.t("اختيار", "Select")}</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="url">URL</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                  {ctx.t("وصف اختياري", "Description")}
                </span>
                <input
                  name="auto-field-xb16qjj"
                  value={fieldDescription}
                  onChange={(e) => setFieldDescription(e.target.value)}
                  placeholder={ctx.t("مساعدة للمستخدم...", "Helper text...")}
                  className={inputCls}
                />
              </label>
              <Btn variant="glow" disabled={!ctx.can("custom_fields.manage")} onClick={addField}>
                + {ctx.t("إضافة", "Add")}
              </Btn>
            </div>
          </div>
          <div className="mt-5 divide-y divide-line rounded-2xl border border-line">
            {ctx.customFields.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-raised">🧩</span>
                <div className="min-w-[200px] flex-1">
                  <div className="text-[13px] font-bold text-ink">{f.name}</div>
                  <div className="mono text-[10.5px] text-ink-faint">
                    {f.key} · {f.type}
                  </div>
                </div>
                <Badge tone={f.sensitive ? "rose" : "neutral"}>
                  {f.sensitive ? ctx.t("حساس", "Sensitive") : ctx.t("عادي", "Standard")}
                </Badge>
                <button
                  onClick={() => void deleteField(f.id, f.name)}
                  disabled={!ctx.can("custom_fields.manage")}
                  aria-label={ctx.t(`حذف الحقل ${f.name}`, `Delete ${f.name} field`)}
                  className="rounded-lg p-1.5 text-ink-faint hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-30"
                >
                  <IconTrash size={15} />
                </button>
              </div>
            ))}
            {ctx.customFields.length === 0 && (
              <div className="p-8 text-center text-[12.5px] text-ink-faint">
                {ctx.t("لا حقول مخصصة بعد", "No custom fields yet")}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "data" && (
        <Card className="bg-surface p-6 space-y-6">
          <div>
            <h3 className="font-bold text-ink">
              {ctx.t("قابلية نقل البيانات والنسخ الاحتياطي", "Data Portability & Backup")}
            </h3>
            <p className="mt-1 text-[12px] text-ink-soft">
              {ctx.t(
                "أنشئ أرشيف ZIP قابل للنقل يتضمن البيانات والملفات، أو تقرير PDF، أو ملف Excel متعدد الأوراق.",
                "Create a portable ZIP archive with data and files, a PDF report, or a multi-sheet Excel workbook.",
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Btn
              variant="glow"
              disabled={Boolean(exporting) || !ctx.activeWorkspace || !ctx.can("data.export")}
              onClick={() => void exportWorkspace("json")}
            >
              {exporting === "json"
                ? ctx.t("جارٍ تجهيز ZIP…", "Preparing ZIP…")
                : ctx.t("تنزيل أرشيف ZIP الكامل", "Download full ZIP archive")}
            </Btn>
            <Btn
              variant="outline"
              disabled={Boolean(exporting) || !ctx.activeWorkspace || !ctx.can("data.export")}
              onClick={() => void exportWorkspace("pdf")}
            >
              {exporting === "pdf"
                ? ctx.t("جارٍ تجهيز PDF…", "Preparing PDF…")
                : ctx.t("تنزيل تقرير PDF", "Download PDF report")}
            </Btn>
            <Btn
              variant="outline"
              disabled={Boolean(exporting) || !ctx.activeWorkspace || !ctx.can("data.export")}
              onClick={() => void exportWorkspace("xlsx")}
            >
              {exporting === "xlsx"
                ? ctx.t("جارٍ تجهيز Excel…", "Preparing Excel…")
                : ctx.t("تنزيل ملف Excel", "Download Excel workbook")}
            </Btn>
          </div>
          {exporting && exportStatus && (
            <p className="text-xs text-indigo-700 dark:text-indigo-300" role="status" aria-live="polite">
              {ctx.t("حالة التصدير: ", "Export status: ")}
              {exportStatusLabel(exportStatus, ctx.t)}
            </p>
          )}

          {organizationAuthorizationLoading ? (
            <ScreenState
              framed={false}
              tone="loading"
              title={ctx.t("جاري التحقق من صلاحيات تصدير المؤسسة…", "Checking organization export permissions…")}
            />
          ) : organizationAuthorizationError ? (
            <ScreenState
              framed={false}
              tone="error"
              title={ctx.t("تعذر التحقق من صلاحية تصدير المؤسسة", "Failed to verify organization export permissions")}
              description={organizationAuthorizationError}
              action={
                <Btn size="sm" variant="outline" onClick={() => setOrganizationAuthorizationKey((value) => value + 1)}>
                  {ctx.t("إعادة المحاولة", "Retry")}
                </Btn>
              }
            />
          ) : !organizationExportAllowed ? (
            <ScreenState
              framed={false}
              tone="permission"
              title={ctx.t("تصدير المؤسسة غير مصرح به", "Organization export not authorized")}
              description={ctx.t(
                "يلزم توفر صلاحية تصدير البيانات على مستوى المؤسسة لتنزيل الأرشيف الكامل.",
                "Organization-level data export permission is required to download the full archive.",
              )}
            />
          ) : (
            <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-ink">
                    {ctx.t("تصدير المؤسسة بالكامل", "Full organization export")}
                  </div>
                  <p className="mt-1 text-[11.5px] text-ink-soft">
                    {ctx.t(
                      "أرشيف ZIP/JSON خاص يشمل جميع مساحات العمل المؤهلة. يتطلب صلاحية تصدير على مستوى المؤسسة.",
                      "A private ZIP/JSON archive covering every eligible workspace. Organization-level export permission is required.",
                    )}
                  </p>
                </div>
                <Btn variant="outline" disabled={organizationExporting} onClick={() => void exportOrganization()}>
                  {organizationExporting
                    ? ctx.t("جارٍ تجهيز أرشيف المؤسسة…", "Preparing organization archive…")
                    : ctx.t("تنزيل أرشيف المؤسسة", "Download organization archive")}
                </Btn>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-raised/50 p-4">
              <div className="text-[11px] text-ink-faint">{ctx.t("المشاريع", "Projects")}</div>
              <div className="mono mt-1 text-2xl font-black text-ink">{fmtNumber(ctx.projects.length, ctx.locale)}</div>
            </div>
            <div className="rounded-xl bg-raised/50 p-4">
              <div className="text-[11px] text-ink-faint">{ctx.t("المهام", "Tasks")}</div>
              <div className="mono mt-1 text-2xl font-black text-ink">{fmtNumber(ctx.tasks.length, ctx.locale)}</div>
            </div>
            <div className="rounded-xl bg-raised/50 p-4">
              <div className="text-[11px] text-ink-faint">{ctx.t("الأعضاء", "Members")}</div>
              <div className="mono mt-1 text-2xl font-black text-ink">{fmtNumber(ctx.members.length, ctx.locale)}</div>
            </div>
          </div>
          <ScheduledReportsPanel ctx={ctx} />
          <OrganizationLifecycleCard ctx={ctx} />
        </Card>
      )}
    </div>
  );
}
