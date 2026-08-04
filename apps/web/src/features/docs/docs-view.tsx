"use client";
import { useState } from "react";
import type { Doc, ViewCtx } from "@/lib/types";
import { fmtDate } from "@/lib/types";
import { Btn, Card, Empty } from "@/components/ui";
import { TiptapEditor } from "@/components/tiptap-editor";
import { IconChevron, IconDoc, IconPlus, IconSparkle } from "@/components/icons";
import { useDocumentVersions } from "@/features/docs/use-document-versions";
import { documentTaskTitle } from "@/features/docs/document-content";
import { flattenDocumentTree } from "@/features/docs/document-tree";
import { useDocumentPermissions, type DocumentPermissionLevel } from "@/features/docs/use-document-permissions";

/* ================= Docs View ================= */
export function DocsView({ ctx }: { ctx: ViewCtx }) {
  const [showTemplates, setShowTemplates] = useState(false);
  const {
    showVersionsModal,
    setShowVersionsModal,
    versions,
    loadingVersions,
    loadVersions,
    saveSnapshot,
    restoreVersion,
  } = useDocumentVersions(ctx.activeDoc, ctx);
  const {
    showPermissions,
    setShowPermissions,
    permissions,
    loadingPermissions,
    permissionUserId,
    setPermissionUserId,
    permissionLevel,
    setPermissionLevel,
    loadPermissions,
    grantPermission,
    revokePermission,
  } = useDocumentPermissions(ctx.activeDoc, ctx);

  if (ctx.activeDoc) {
    const doc = ctx.activeDoc;
    const canEdit = doc.accessLevel === "editor" || doc.accessLevel === "manager";
    const canManage = doc.accessLevel === "manager";
    const convertToTask = (text?: string) => {
      if (!doc) return;
      const title = text || documentTaskTitle(doc.content, doc.title);
      if (ctx.createTask) {
        ctx.createTask({ title, description: `تم تحويله من المستند: ${doc.title}\n\n${text ? `> ${text}` : ""}` });
      } else {
        ctx.setShowAddTask(true);
      }
    };

    const applyTemplate = (md: string) => {
      if (
        doc.content &&
        !confirm(ctx.t("استبدال المحتوى الحالي بقالب جديد؟", "Replace current content with template?"))
      )
        return;
      ctx.patchDoc(doc.id, { content: md });
      setShowTemplates(false);
      ctx.notify(ctx.t("تم تطبيق القالب ✓", "Template applied ✓"));
    };

    return (
      <Card className="overflow-hidden max-w-[880px] mx-auto bg-white dark:bg-white/[0.02]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-white/[0.06] px-5 py-3.5 bg-slate-50/50 dark:bg-transparent">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.04] text-[16px] shadow-sm dark:shadow-none">
              {doc.icon}
            </span>
            <input
              name="auto-field-v4kxo96"
              key={doc.id}
              defaultValue={doc.title}
              readOnly={!canEdit}
              onBlur={(e) => ctx.patchDoc(doc.id, { title: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-slate-900 dark:text-white outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Btn
                size="sm"
                variant="outline"
                disabled={!canEdit}
                onClick={() => setShowTemplates(!showTemplates)}
                className="border-slate-300 dark:border-white/15"
              >
                📑 {ctx.t("قوالب جاهزة", "Templates")}
              </Btn>
              {showTemplates && (
                <div className="absolute end-0 top-9 z-40 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl dark:border-white/10 dark:bg-zinc-900 dark:shadow-[0_16px_50px_rgba(0,0,0,0.7)] animate-pop">
                  <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                    {ctx.t("اختر قالباً لبدء العمل", "Select a template")}
                  </div>
                  {[
                    [
                      "محضر اجتماع (Meeting Notes)",
                      `# محضر اجتماع\n- **التاريخ:** ${new Date().toLocaleDateString("ar-EG")}\n- **الحاضرون:** @الفريق\n\n## جدول الأعمال\n1. مراجعة إنجازات الأسبوع\n2. التحديات الحالية\n\n## عناصر العمل (Action Items)\n- [ ] مراجعة الكود النهائي\n- [ ] اعتماد الميزانية`,
                    ],
                    [
                      "وثيقة متطلبات (PRD)",
                      `# وثيقة متطلبات المنتج (PRD)\n## الهدف الاستراتيجي\nتطوير وتوسيع المنصة لتلبي احتياجات المؤسسات الكبرى.\n\n## المتطلبات الوظيفية\n- [ ] واجهة المستخدم التفاعلية\n- [ ] نقاط الـ API والمصادقة\n\n## مقاييس النجاح (KPIs)\n- زيادة التفاعل بنسبة 20%`,
                    ],
                    [
                      "مواصفات فنية (Technical Spec)",
                      `# المواصفات الفنية\n## المعمارية المعتمدة\n\`\`\`typescript\ninterface TenantConfig {\n  tenantId: string;\n  ssl: boolean;\n}\n\`\`\`\n\n## الأمان وعزل المستأجرين\nيتم فحص الصلاحية في الخادم لكل طلب مع RLS.`,
                    ],
                  ].map(([label, content]) => (
                    <button
                      key={label}
                      onClick={() => applyTemplate(content)}
                      className="w-full rounded-xl px-2.5 py-2 text-start text-[12px] font-semibold text-slate-700 hover:bg-slate-100 dark:text-zinc-200 dark:hover:bg-white/5 transition"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Btn size="sm" variant="outline" onClick={loadVersions} className="border-slate-300 dark:border-white/15">
              🕒 {ctx.t("تاريخ الإصدارات", "History")}
            </Btn>
            {canManage && (
              <Btn
                size="sm"
                variant="outline"
                onClick={loadPermissions}
                className="border-slate-300 dark:border-white/15"
              >
                🔐 {ctx.t("المشاركة", "Access")}
              </Btn>
            )}
            <Btn
              size="sm"
              variant="outline"
              onClick={() => convertToTask()}
              className="hidden sm:inline-flex border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
            >
              <IconSparkle size={13} />
              {ctx.t("تحويل إلى مهمة", "Turn into task")}
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => ctx.setActiveDoc(null)}>
              <IconChevron size={14} className="rotate-180 rtl:rotate-0" />
              {ctx.t("رجوع", "Back")}
            </Btn>
          </div>
        </div>
        <div className="px-6 py-2 min-h-[420px]">
          <TiptapEditor
            key={`ed-${doc.id}`}
            initialContent={doc.content || ""}
            onChange={(md) => ctx.patchDoc(doc.id, { content: md })}
            onTurnIntoTask={(text) => convertToTask(text)}
            locale={ctx.locale}
            editable={canEdit}
          />
        </div>
        {canManage && (
          <div className="grid gap-3 border-t border-slate-200/80 bg-slate-50/60 px-6 py-4 text-[12px] dark:border-white/[0.06] dark:bg-white/[0.015] sm:grid-cols-2">
            <label className="space-y-1.5 text-slate-600 dark:text-zinc-400">
              <span className="font-semibold">{ctx.t("الصفحة الأصل", "Parent page")}</span>
              <select
                name="auto-field-iuuwcrg"
                value={doc.parentId ?? ""}
                onChange={(event) => ctx.patchDoc(doc.id, { parentId: event.target.value || null })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none dark:border-white/10 dark:bg-zinc-900 dark:text-white"
              >
                <option value="">{ctx.t("صفحة رئيسية", "Top-level page")}</option>
                {ctx.docs
                  .filter((candidate) => candidate.id !== doc.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="space-y-1.5 text-slate-600 dark:text-zinc-400">
              <span className="font-semibold">{ctx.t("وصول مساحة العمل", "Workspace access")}</span>
              <select
                name="auto-field-m2juwib"
                value={doc.workspaceAccess ?? "viewer"}
                onChange={(event) =>
                  ctx.patchDoc(doc.id, {
                    workspaceAccess: event.target.value as "none" | "viewer" | "editor",
                  })
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none dark:border-white/10 dark:bg-zinc-900 dark:text-white"
              >
                <option value="none">{ctx.t("خاص", "Private")}</option>
                <option value="viewer">{ctx.t("عرض", "Can view")}</option>
                <option value="editor">{ctx.t("تحرير", "Can edit")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-slate-600 dark:text-zinc-400">
              <input
                name="auto-field-akdgd21"
                type="checkbox"
                checked={doc.inheritPermissions ?? true}
                onChange={(event) => ctx.patchDoc(doc.id, { inheritPermissions: event.target.checked })}
              />
              {ctx.t("وراثة صلاحيات الصفحة الأصل", "Inherit parent permissions")}
            </label>
            <label className="flex items-center gap-2 text-slate-600 dark:text-zinc-400">
              <input
                name="auto-field-r7rapft"
                type="checkbox"
                checked={doc.isPublic ?? false}
                onChange={(event) => ctx.patchDoc(doc.id, { isPublic: event.target.checked })}
              />
              {ctx.t("رابط عام للقراءة", "Public read access")}
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between border-t border-slate-200/80 dark:border-white/[0.06] bg-slate-50/80 dark:bg-white/[0.02] px-6 py-3 text-[11px] text-slate-500 dark:text-zinc-600">
          <span>
            {ctx.t("يُحفظ تلقائياً في الخلفية", "Auto-saves in background")} • {doc.author?.name || "المؤلف"}
          </span>
          <div className="flex items-center gap-3">
            <button
              disabled={!canEdit}
              onClick={saveSnapshot}
              className="font-semibold text-indigo-600 dark:text-violet-400 hover:underline disabled:hidden"
            >
              💾 {ctx.t("حفظ لقطة إصدار الآن", "Save version snapshot")}
            </button>
            <button
              onClick={() => convertToTask()}
              className="sm:hidden text-indigo-600 dark:text-indigo-400 font-semibold"
            >
              {ctx.t("+ مهمة", "+ Task")}
            </button>
          </div>
        </div>

        {/* Versions Modal */}
        {showVersionsModal && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-slate-900/60 dark:bg-zinc-950/70 backdrop-blur-md animate-fade"
              onClick={() => setShowVersionsModal(false)}
            />
            <div className="animate-pop relative w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900/95 max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-white/10">
                <div>
                  <h3 className="text-[16px] font-bold text-slate-900 dark:text-white">
                    {ctx.t("تاريخ إصدارات المستند (Version History — القسم 16)", "Document Version History")}
                  </h3>
                  <p className="text-[12px] text-slate-500 dark:text-zinc-400">
                    استعراض اللقطات المحفوظة وإمكانية استعادة نسخة سابقة في أي وقت.
                  </p>
                </div>
                <button
                  onClick={() => setShowVersionsModal(false)}
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="my-4 flex justify-end">
                <Btn size="sm" variant="glow" disabled={!canEdit} onClick={saveSnapshot}>
                  + {ctx.t("حفظ لقطة جديدة الآن", "Create snapshot now")}
                </Btn>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {loadingVersions ? (
                  <div className="py-12 text-center text-slate-400">جاري تحميل تاريخ الإصدارات...</div>
                ) : (
                  versions.map((ver) => (
                    <div
                      key={ver.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-white/10 dark:bg-white/[0.03]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-indigo-600 dark:text-violet-300">
                              v{ver.versionNumber}
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white text-[13.5px]">{ver.title}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">
                            بواسطة: <span className="font-semibold">{ver.savedBy?.name || "النظام"}</span> ·{" "}
                            {new Date(ver.createdAt).toLocaleString("ar-EG")}
                          </div>
                          <div className="mt-2.5 rounded-lg bg-white p-2.5 font-mono text-[11.5px] text-slate-700 line-clamp-3 dark:bg-black/40 dark:text-zinc-300 border border-slate-100 dark:border-white/5">
                            {ver.content || "(محتوى فارغ)"}
                          </div>
                        </div>
                        <Btn
                          size="sm"
                          variant="outline"
                          disabled={!canEdit}
                          className="shrink-0 border-indigo-200 text-indigo-700 dark:border-indigo-500/30 dark:text-violet-300"
                          onClick={() => restoreVersion(ver.id)}
                        >
                          ↩️ استعادة (Restore)
                        </Btn>
                      </div>
                    </div>
                  ))
                )}
                {!loadingVersions && versions.length === 0 && (
                  <p className="py-8 text-center text-slate-400">لا توجد إصدارات مسجلة بعد.</p>
                )}
              </div>
            </div>
          </div>
        )}
        {showPermissions && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
            <button
              aria-label={ctx.t("إغلاق", "Close")}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md dark:bg-zinc-950/75"
              onClick={() => setShowPermissions(false)}
            />
            <div className="relative w-full max-w-[560px] rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">
                    {ctx.t("صلاحيات المستند", "Document access")}
                  </h3>
                  <p className="mt-1 text-[12px] text-slate-500 dark:text-zinc-400">
                    {ctx.t(
                      "امنح عضواً صلاحية عرض أو تحرير أو إدارة هذا المستند.",
                      "Grant view, edit, or manager access.",
                    )}
                  </p>
                </div>
                <button
                  onClick={() => setShowPermissions(false)}
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_130px_auto]">
                <select
                  name="auto-field-jypxr8i"
                  value={permissionUserId}
                  onChange={(event) => setPermissionUserId(event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                >
                  <option value="">{ctx.t("اختر عضواً", "Select member")}</option>
                  {ctx.members
                    .filter(
                      (member) =>
                        member.status === "active" &&
                        member.userId !== ctx.currentUser?.id &&
                        member.userId !== doc.authorId,
                    )
                    .map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.user?.name || member.user?.email || member.userId}
                      </option>
                    ))}
                </select>
                <select
                  name="auto-field-to8r9yd"
                  value={permissionLevel}
                  onChange={(event) => setPermissionLevel(event.target.value as DocumentPermissionLevel)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 dark:border-white/10 dark:bg-zinc-950 dark:text-white"
                >
                  <option value="viewer">{ctx.t("عرض", "Viewer")}</option>
                  <option value="editor">{ctx.t("تحرير", "Editor")}</option>
                  <option value="manager">{ctx.t("إدارة", "Manager")}</option>
                </select>
                <Btn size="sm" variant="glow" disabled={!permissionUserId} onClick={grantPermission}>
                  {ctx.t("حفظ", "Save")}
                </Btn>
              </div>
              <div className="mt-5 max-h-72 space-y-2 overflow-y-auto">
                {loadingPermissions ? (
                  <p className="py-8 text-center text-slate-400">{ctx.t("جارٍ التحميل…", "Loading…")}</p>
                ) : (
                  permissions.map((permission) => (
                    <div
                      key={permission.id}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
                    >
                      <div>
                        <p className="text-[12px] font-semibold text-slate-900 dark:text-white">
                          {permission.user?.name || permission.user?.email || permission.userId}
                        </p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-400">{permission.accessLevel}</p>
                      </div>
                      <button
                        onClick={() => revokePermission(permission.userId)}
                        className="text-[11px] font-semibold text-rose-600 hover:underline dark:text-rose-400"
                      >
                        {ctx.t("إزالة", "Remove")}
                      </button>
                    </div>
                  ))
                )}
                {!loadingPermissions && permissions.length === 0 && (
                  <p className="py-6 text-center text-[12px] text-slate-400">
                    {ctx.t("لا توجد صلاحيات فردية بعد.", "No individual grants yet.")}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    );
  }
  return (
    <div className="max-w-[820px] mx-auto">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-[19px] font-bold text-slate-900 dark:text-white">
            {ctx.t("المستندات والمعرفة", "Docs & Wiki")}
          </h2>
          <p className="mt-0.5 text-[12px] text-slate-500 dark:text-zinc-500">
            {ctx.docs.length} {ctx.t("مستند في مساحة العمل", "docs in workspace")}
          </p>
        </div>
        <Btn variant="glow" disabled={!ctx.can("documents.manage")} onClick={() => ctx.setShowNewDoc(true)}>
          <IconPlus size={15} />
          {ctx.t("مستند جديد", "New Doc")}
        </Btn>
      </div>
      <div className="stagger space-y-2">
        {flattenDocumentTree(ctx.docs).map(({ document: d, depth }) => (
          <button
            key={d.id}
            onClick={() => ctx.setActiveDoc(d)}
            className="task-card group flex w-full items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-start shadow-sm dark:border-white/[0.07] dark:bg-white/[0.025] dark:shadow-none"
            style={{ paddingInlineStart: `${16 + Math.min(depth, 9) * 24}px` }}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-indigo-50/50 text-[18px] dark:border-white/10 dark:bg-gradient-to-br dark:from-indigo-500/15 dark:to-violet-400/15">
              {d.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-slate-900 group-hover:text-indigo-600 dark:text-zinc-100 dark:group-hover:text-white">
                {d.title}
              </div>
              <div className="mt-1 text-[11.5px] text-slate-500 dark:text-zinc-500">
                {d.updatedAt ? fmtDate(d.updatedAt, ctx.locale) : ""} • {d.author?.name}
                {depth > 0 ? ` • ${ctx.t("صفحة فرعية", "Subpage")}` : ""}
              </div>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase text-slate-500 dark:bg-white/5 dark:text-zinc-400">
              {d.accessLevel ?? "viewer"}
            </span>
            <IconChevron
              size={15}
              className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-indigo-600 dark:text-zinc-600 dark:group-hover:text-violet-300 rtl:rotate-180 rtl:group-hover:-translate-x-1"
            />
          </button>
        ))}
      </div>
      {ctx.docs.length === 0 && (
        <Card>
          <Empty
            icon={<IconDoc size={22} />}
            title={ctx.t("لا مستندات بعد", "No docs yet")}
            hint={ctx.t(
              "أنشئ قاعدة المعرفة الخاصة بفريقك وحول الفقرات إلى مهام",
              "Build your team knowledge base and turn text into tasks",
            )}
            action={
              <Btn variant="glow" disabled={!ctx.can("documents.manage")} onClick={() => ctx.setShowNewDoc(true)}>
                <IconPlus size={14} />
                {ctx.t("أول مستند", "First doc")}
              </Btn>
            }
          />
        </Card>
      )}
    </div>
  );
}
