"use client";
import { useEffect, useState } from "react";
import type { ViewCtx } from "@/lib/types";
import { areaCls, Badge, Btn, Card, inputCls, selectCls } from "@/components/ui";
import {
  downloadPreparedWorkspaceExport,
  getOrganizationAuthorization,
  prepareOrganizationExport,
  prepareWorkspaceExport,
} from "@/features/workspace/export-api";
import type { WorkspaceExportFormat } from "@/features/workspace/export-api";
import { ScheduledReportsPanel } from "./scheduled-reports-panel";
import { OrganizationLifecycleCard } from "@/features/data-lifecycle/lifecycle-cards";

/* ================= Workspace Settings View ================= */
export function SettingsView({ ctx }: { ctx: ViewCtx }) {
  const [tab, setTab] = useState<"general" | "fields" | "data">("general");
  const [name, setName] = useState(ctx.activeWorkspace?.name || "");
  const [description, setDescription] = useState(ctx.activeWorkspace?.description || "");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState("short_text");
  const [fieldDescription, setFieldDescription] = useState("");
  const [exporting, setExporting] = useState<WorkspaceExportFormat | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [organizationExporting, setOrganizationExporting] = useState(false);
  const [organizationExportAllowed, setOrganizationExportAllowed] = useState(false);

  useEffect(() => {
    const organizationId = ctx.activeOrg?.id;
    if (!organizationId || tab !== "data") {
      setOrganizationExportAllowed(false);
      return;
    }
    let active = true;
    void getOrganizationAuthorization({ organizationId })
      .then((authorization) => {
        if (active) setOrganizationExportAllowed(authorization.permissions.includes("data.export"));
      })
      .catch(() => {
        if (active) setOrganizationExportAllowed(false);
      });
    return () => {
      active = false;
    };
  }, [ctx.activeOrg?.id, tab]);

  const saveGeneral = () => {
    ctx.updateWorkspace({ name, description });
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
    <div className="max-w-[900px] mx-auto space-y-6 animate-fade">
      <div>
        <h2 className="text-[20px] font-bold text-slate-900 dark:text-white">
          {ctx.t("إعدادات مساحة العمل", "Workspace Settings")}
        </h2>
        <p className="mt-1 text-[12.5px] text-slate-500 dark:text-zinc-400">
          {ctx.t(
            "إدارة هوية المساحة والحقول المخصصة ونقل البيانات",
            "Manage workspace identity, custom fields, and data portability",
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-white/10">
        {[
          ["general", "⚙️ عام", "General"],
          ["fields", "🧩 الحقول المخصصة", "Custom Fields"],
          ["data", "💾 البيانات والتصدير", "Data & Export"],
        ].map(([key, ar, en]) => (
          <button
            key={key}
            onClick={() => setTab(key as any)}
            className={`rounded-xl px-4 py-2 text-[12.5px] font-semibold transition ${tab === key ? "bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:bg-white/10"}`}
          >
            {ctx.t(ar, en)}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <Card className="p-6 bg-white dark:bg-white/[0.025]">
          <div className="flex items-center gap-3 mb-6">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              ⚙️
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">
                {ctx.t("معلومات مساحة العمل", "Workspace Identity")}
              </h3>
              <p className="text-[11.5px] text-slate-500 dark:text-zinc-500">{ctx.activeWorkspace?.slug}</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-500">
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
              <span className="mb-1.5 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-500">
                {ctx.t("اللون", "Brand color")}
              </span>
              <div className="flex items-center gap-3">
                <input
                  name="auto-field-hm6lu1q"
                  type="color"
                  value={ctx.activeWorkspace?.color || "#6366f1"}
                  onChange={(e) => ctx.updateWorkspace({ color: e.target.value })}
                  className="h-10 w-14 rounded-lg border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-zinc-900"
                />
                <span className="mono text-[12px] text-slate-500 dark:text-zinc-400">{ctx.activeWorkspace?.color}</span>
              </div>
            </label>
          </div>
          <label className="block mt-4">
            <span className="mb-1.5 block text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-500">
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
            <Btn variant="glow" disabled={!ctx.can("workspace.manage")} onClick={saveGeneral}>
              {ctx.t("حفظ الإعدادات", "Save settings")}
            </Btn>
          </div>
        </Card>
      )}

      {tab === "fields" && (
        <Card className="p-6 bg-white dark:bg-white/[0.025]">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">
                {ctx.t("حقول المهام المخصصة", "Custom Task Fields")}
              </h3>
              <p className="text-[11.5px] text-slate-500 dark:text-zinc-500">
                {ctx.customFields.length} {ctx.t("حقل مرتبط بهذه المساحة", "fields in this workspace")}
              </p>
            </div>
            <Badge tone="indigo">Workspace scoped</Badge>
          </div>
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/25 dark:bg-indigo-500/[0.06]">
            <div className="grid gap-3 md:grid-cols-[1fr_150px_1fr_auto] items-end">
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
          <div className="mt-5 divide-y divide-slate-100 dark:divide-white/[0.05] rounded-2xl border border-slate-200 dark:border-white/10">
            {ctx.customFields.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 dark:bg-white/[0.05]">🧩</span>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[13px] font-bold text-slate-900 dark:text-white">{f.name}</div>
                  <div className="mono text-[10.5px] text-slate-500 dark:text-zinc-500">
                    {f.key} · {f.type}
                  </div>
                </div>
                <Badge tone={f.sensitive ? "rose" : "neutral"}>
                  {f.sensitive ? ctx.t("حساس", "Sensitive") : ctx.t("عادي", "Standard")}
                </Badge>
                <button
                  onClick={() => ctx.deleteCustomField(f.id)}
                  className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                >
                  🗑️
                </button>
              </div>
            ))}
            {ctx.customFields.length === 0 && (
              <div className="p-8 text-center text-[12.5px] text-slate-500">
                {ctx.t("لا حقول مخصصة بعد", "No custom fields yet")}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "data" && (
        <Card className="p-6 bg-white dark:bg-white/[0.025]">
          <h3 className="font-bold text-slate-900 dark:text-white">
            {ctx.t("قابلية نقل البيانات والنسخ الاحتياطي", "Data Portability & Backup")}
          </h3>
          <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
            {ctx.t(
              "أنشئ أرشيف ZIP قابل للنقل يتضمن البيانات والملفات، أو تقرير PDF، أو ملف Excel متعدد الأوراق.",
              "Create a portable ZIP archive with data and files, a PDF report, or a multi-sheet Excel workbook.",
            )}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
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
          {organizationExportAllowed && (
            <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/25 dark:bg-indigo-500/[0.06]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-slate-900 dark:text-white">
                    {ctx.t("تصدير المؤسسة بالكامل", "Full organization export")}
                  </div>
                  <p className="mt-1 text-[11.5px] text-slate-500 dark:text-zinc-400">
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
          {exporting && exportStatus && (
            <p className="mt-3 text-xs text-indigo-700 dark:text-indigo-300" role="status" aria-live="polite">
              {ctx.t(`حالة التصدير: ${exportStatus}`, `Export status: ${exportStatus}`)}
            </p>
          )}
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/[0.03]">
              <div className="text-[11px] text-slate-500">{ctx.t("المشاريع", "Projects")}</div>
              <div className="mono mt-1 text-2xl font-black">{ctx.projects.length}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/[0.03]">
              <div className="text-[11px] text-slate-500">{ctx.t("المهام", "Tasks")}</div>
              <div className="mono mt-1 text-2xl font-black">{ctx.tasks.length}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-white/[0.03]">
              <div className="text-[11px] text-slate-500">{ctx.t("الأعضاء", "Members")}</div>
              <div className="mono mt-1 text-2xl font-black">{ctx.members.length}</div>
            </div>
          </div>
          <ScheduledReportsPanel ctx={ctx} />
          <OrganizationLifecycleCard ctx={ctx} />
        </Card>
      )}
    </div>
  );
}
