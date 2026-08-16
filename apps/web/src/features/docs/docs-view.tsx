"use client";

import { useState } from "react";
import type { Doc, ViewCtx } from "@/lib/types";
import { fmtDate, fmtNumber } from "@/lib/types";
import { Btn, Card, Modal, ScreenHeader, ScreenState, SectionTitle, selectCls } from "@/components/ui";
import { confirmAction } from "@/components/feedback";
import { TiptapEditor } from "@/components/tiptap-editor";
import { IconChevron, IconClock, IconDoc, IconLock, IconPlus, IconRotateCw, IconSparkle } from "@/components/icons";
import { useDocumentVersions } from "@/features/docs/use-document-versions";
import { documentTaskTitle } from "@/features/docs/document-content";
import { flattenDocumentTree } from "@/features/docs/document-tree";
import { useDocumentPermissions, type DocumentPermissionLevel } from "@/features/docs/use-document-permissions";

const dateLocale = (locale: string) => (locale === "ar" ? "ar-u-nu-latn" : "en-US");

export function DocsView({ ctx }: { ctx: ViewCtx }) {
  const [showTemplates, setShowTemplates] = useState(false);
  const {
    showVersionsModal,
    setShowVersionsModal,
    versions,
    loadingVersions,
    versionError,
    versionActionBusy,
    loadVersions,
    saveSnapshot,
    restoreVersion,
  } = useDocumentVersions(ctx.activeDoc, ctx);

  const {
    showPermissions,
    setShowPermissions,
    permissions,
    loadingPermissions,
    permissionError,
    permissionActionBusy,
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
        ctx.createTask({
          title,
          description: `${ctx.t("تم تحويله من المستند:", "Turned into task from doc:")} ${doc.title}\n\n${text ? `> ${text}` : ""}`,
        });
      } else {
        ctx.setShowAddTask(true);
      }
    };

    const applyTemplate = async (md: string) => {
      if (doc.content) {
        const confirmed = await confirmAction({
          title: ctx.t("استبدال المحتوى بالقالب", "Replace content with template"),
          message: ctx.t(
            "هل أنت متأكد من استبدال المحتوى الحالي بقالب جديد؟",
            "Are you sure you want to replace current content with template?",
          ),
          tone: "danger",
        });
        if (!confirmed) return;
      }
      ctx.patchDoc(doc.id, { content: md });
      setShowTemplates(false);
      ctx.notify(ctx.t("تم تطبيق القالب ✓", "Template applied ✓"));
    };

    return (
      <Card className="screen-container-wide overflow-hidden bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raised/60 px-5 py-3.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-[16px] shadow-sm">
              {doc.icon}
            </span>
            <input
              name="doc-title-input"
              key={doc.id}
              defaultValue={doc.title}
              readOnly={!canEdit}
              onBlur={(e) => ctx.patchDoc(doc.id, { title: e.target.value })}
              className="min-w-0 flex-1 bg-transparent text-[16px] font-bold text-ink outline-none"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Btn size="sm" variant="outline" disabled={!canEdit} onClick={() => setShowTemplates(!showTemplates)}>
                📑 {ctx.t("قوالب جاهزة", "Templates")}
              </Btn>
              {showTemplates && (
                <div className="animate-pop fixed inset-x-2 top-24 z-40 rounded-2xl border border-line bg-surface p-2 shadow-2xl sm:absolute sm:inset-x-auto sm:end-0 sm:top-9 sm:w-60">
                  <div className="mb-1 px-2 text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                    {ctx.t("اختر قالباً لبدء العمل", "Select a template")}
                  </div>
                  {[
                    [
                      ctx.t("محضر اجتماع (Meeting Notes)", "Meeting Notes"),
                      `# محضر اجتماع\n- **التاريخ:** ${new Date().toLocaleDateString(dateLocale(ctx.locale))}\n- **الحاضرون:** @الفريق\n\n## جدول الأعمال\n1. مراجعة إنجازات الأسبوع\n2. التحديات الحالية\n\n## عناصر العمل (Action Items)\n- [ ] مراجعة الكود النهائي\n- [ ] اعتماد الميزانية`,
                    ],
                    [
                      ctx.t("وثيقة متطلبات (PRD)", "Product Requirements (PRD)"),
                      `# وثيقة متطلبات المنتج (PRD)\n## الهدف الاستراتيجي\nتطوير وتوسيع المنصة لتلبي احتياجات المؤسسات الكبرى.\n\n## المتطلبات الوظيفية\n- [ ] واجهة المستخدم التفاعلية\n- [ ] نقاط الـ API والمصادقة\n\n## مقاييس النجاح (KPIs)\n- زيادة التفاعل بنسبة 20%`,
                    ],
                    [
                      ctx.t("مواصفات فنية (Technical Spec)", "Technical Spec"),
                      `# المواصفات الفنية\n## المعمارية المعتمدة\n\`\`\`typescript\ninterface TenantConfig {\n  tenantId: string;\n  ssl: boolean;\n}\n\`\`\`\n\n## الأمان وعزل المستأجرين\nيتم فحص الصلاحية في الخادم لكل طلب مع RLS.`,
                    ],
                  ].map(([label, content]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => void applyTemplate(content)}
                      className="w-full rounded-xl px-2.5 py-2 text-start text-[12px] font-semibold text-ink-soft transition hover:bg-raised"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Btn size="sm" variant="outline" onClick={loadVersions}>
              <IconClock size={14} />
              {ctx.t("تاريخ الإصدارات", "History")}
            </Btn>

            {canManage && (
              <Btn size="sm" variant="outline" onClick={loadPermissions}>
                <IconLock size={14} />
                {ctx.t("المشاركة", "Access")}
              </Btn>
            )}

            <Btn size="sm" variant="outline" onClick={() => convertToTask()} className="hidden sm:inline-flex">
              <IconSparkle size={13} />
              {ctx.t("تحويل إلى مهمة", "Turn into task")}
            </Btn>

            <Btn size="sm" variant="ghost" onClick={() => ctx.setActiveDoc(null)}>
              <IconChevron size={14} className="rotate-180 rtl:rotate-0" />
              {ctx.t("رجوع", "Back")}
            </Btn>
          </div>
        </div>

        <div className="min-h-[420px] px-6 py-2">
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
          <div className="grid gap-3 border-t border-line bg-raised/30 px-6 py-4 text-[12px] sm:grid-cols-2">
            <label className="space-y-1.5 text-ink-soft">
              <span className="font-semibold">{ctx.t("الصفحة الأصل", "Parent page")}</span>
              <select
                name="doc-parent-id"
                value={doc.parentId ?? ""}
                onChange={(event) => ctx.patchDoc(doc.id, { parentId: event.target.value || null })}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none"
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
            <label className="space-y-1.5 text-ink-soft">
              <span className="font-semibold">{ctx.t("وصول مساحة العمل", "Workspace access")}</span>
              <select
                name="doc-workspace-access"
                value={doc.workspaceAccess ?? "viewer"}
                onChange={(event) =>
                  ctx.patchDoc(doc.id, {
                    workspaceAccess: event.target.value as "none" | "viewer" | "editor",
                  })
                }
                className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-ink outline-none"
              >
                <option value="none">{ctx.t("خاص", "Private")}</option>
                <option value="viewer">{ctx.t("عرض", "Can view")}</option>
                <option value="editor">{ctx.t("تحرير", "Can edit")}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-ink-soft">
              <input
                name="doc-inherit-permissions"
                type="checkbox"
                checked={doc.inheritPermissions ?? true}
                onChange={(event) => ctx.patchDoc(doc.id, { inheritPermissions: event.target.checked })}
              />
              {ctx.t("وراثة صلاحيات الصفحة الأصل", "Inherit parent permissions")}
            </label>
            <label className="flex items-center gap-2 text-ink-soft">
              <input
                name="doc-is-public"
                type="checkbox"
                checked={doc.isPublic ?? false}
                onChange={(event) => ctx.patchDoc(doc.id, { isPublic: event.target.checked })}
              />
              {ctx.t("رابط عام للقراءة", "Public read access")}
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between border-t border-line bg-raised/50 px-6 py-3 text-[11px] text-ink-faint">
          <span>
            {ctx.t("يُحفظ تلقائياً في الخلفية", "Auto-saves in background")} •{" "}
            {doc.author?.name || ctx.t("المؤلف", "Author")}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!canEdit || versionActionBusy}
              onClick={saveSnapshot}
              className="font-semibold text-accent hover:underline disabled:hidden"
            >
              💾 {ctx.t("حفظ لقطة إصدار الآن", "Save version snapshot")}
            </button>
            <button type="button" onClick={() => convertToTask()} className="font-semibold text-accent sm:hidden">
              {ctx.t("+ مهمة", "+ Task")}
            </button>
          </div>
        </div>

        {/* Versions Modal */}
        <Modal
          open={showVersionsModal}
          onClose={() => setShowVersionsModal(false)}
          title={ctx.t("تاريخ إصدارات المستند", "Document Version History")}
          description={ctx.t(
            "استعراض اللقطات المحفوظة وإمكانية استعادة نسخة سابقة في أي وقت.",
            "Review snapshots and restore previous revisions seamlessly.",
          )}
          size="large"
        >
          <div className="space-y-4">
            <div className="flex justify-end">
              <Btn
                size="sm"
                variant="glow"
                disabled={!canEdit || versionActionBusy}
                aria-busy={versionActionBusy}
                onClick={saveSnapshot}
              >
                <IconPlus size={14} />
                {ctx.t("حفظ لقطة جديدة الآن", "Create snapshot now")}
              </Btn>
            </div>

            {loadingVersions ? (
              <ScreenState
                framed={false}
                tone="loading"
                title={ctx.t("جاري تحميل تاريخ الإصدارات…", "Loading version history…")}
                description={ctx.t(
                  "يرجى الانتظار بينما نجلب لقطات المستند.",
                  "Please wait while we fetch document snapshots.",
                )}
              />
            ) : versionError ? (
              <ScreenState
                framed={false}
                tone="error"
                title={ctx.t("تعذر تحميل تاريخ الإصدارات", "Failed to load version history")}
                description={versionError}
                action={
                  <Btn variant="outline" size="sm" onClick={() => void loadVersions()}>
                    <IconRotateCw size={14} />
                    {ctx.t("إعادة المحاولة", "Retry")}
                  </Btn>
                }
              />
            ) : versions.length === 0 ? (
              <ScreenState
                framed={false}
                tone="empty"
                title={ctx.t("لا توجد إصدارات مسجلة بعد", "No versions saved yet")}
                description={ctx.t(
                  "احفظ لقطة الآن للاحتفاظ بنسخة للرجوع إليها مستقبلاً.",
                  "Save a snapshot now to keep a recoverable milestone.",
                )}
              />
            ) : (
              <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                {versions.map((ver) => (
                  <div
                    key={ver.id}
                    className="rounded-xl border border-line bg-raised/40 p-4 transition hover:bg-raised/70"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-accent">
                            v{fmtNumber(ver.versionNumber, ctx.locale)}
                          </span>
                          <span className="truncate text-[13.5px] font-bold text-ink">{ver.title}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-ink-faint">
                          {ctx.t("بواسطة:", "By:")}{" "}
                          <span className="font-semibold">{ver.savedBy?.name || ctx.t("النظام", "System")}</span> ·{" "}
                          <time
                            dateTime={
                              typeof ver.createdAt === "string" ? ver.createdAt : new Date(ver.createdAt).toISOString()
                            }
                          >
                            {new Date(ver.createdAt).toLocaleString(dateLocale(ctx.locale))}
                          </time>
                        </div>
                        <div className="mt-2.5 line-clamp-3 rounded-lg border border-line bg-surface p-2.5 font-mono text-[11.5px] text-ink-soft">
                          {ver.content || ctx.t("(محتوى فارغ)", "(Empty content)")}
                        </div>
                      </div>
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={!canEdit || versionActionBusy}
                        className="shrink-0"
                        onClick={() => restoreVersion(ver.id)}
                      >
                        ↩️ {ctx.t("استعادة", "Restore")}
                      </Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        {/* Permissions Modal */}
        <Modal
          open={showPermissions}
          onClose={() => setShowPermissions(false)}
          title={ctx.t("صلاحيات المستند", "Document access")}
          description={ctx.t(
            "امنح أعضاء مساحة العمل صلاحيات عرض أو تحرير أو إدارة هذا المستند.",
            "Grant view, edit, or manager access to workspace members.",
          )}
          size="large"
        >
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
              <select
                name="grant-permission-user-id"
                value={permissionUserId}
                onChange={(event) => setPermissionUserId(event.target.value)}
                className="rounded-xl border border-line bg-surface px-3 py-2 text-[12px] text-ink outline-none"
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
                name="grant-permission-level"
                value={permissionLevel}
                onChange={(event) => setPermissionLevel(event.target.value as DocumentPermissionLevel)}
                className={selectCls}
              >
                <option value="viewer">{ctx.t("عرض", "Viewer")}</option>
                <option value="editor">{ctx.t("تحرير", "Editor")}</option>
                <option value="manager">{ctx.t("إدارة", "Manager")}</option>
              </select>
              <Btn
                size="sm"
                variant="glow"
                disabled={!permissionUserId || permissionActionBusy}
                aria-busy={permissionActionBusy}
                onClick={grantPermission}
              >
                {ctx.t("حفظ", "Save")}
              </Btn>
            </div>

            {loadingPermissions ? (
              <ScreenState
                framed={false}
                tone="loading"
                title={ctx.t("جارٍ تحميل الصلاحيات…", "Loading access…")}
                description={ctx.t(
                  "يرجى الانتظار أثناء جلب قائمة الصلاحيات.",
                  "Please wait while fetching access list.",
                )}
              />
            ) : permissionError ? (
              <ScreenState
                framed={false}
                tone="error"
                title={ctx.t("تعذر تحميل الصلاحيات", "Failed to load access")}
                description={permissionError}
                action={
                  <Btn variant="outline" size="sm" onClick={() => void loadPermissions()}>
                    <IconRotateCw size={14} />
                    {ctx.t("إعادة المحاولة", "Retry")}
                  </Btn>
                }
              />
            ) : permissions.length === 0 ? (
              <ScreenState
                framed={false}
                tone="empty"
                title={ctx.t("لا توجد صلاحيات فردية بعد", "No individual grants yet")}
                description={ctx.t(
                  "استخدم النموذج بالأعلى لمنح صلاحيات إضافية لأعضاء الفريق.",
                  "Use the form above to grant specific roles to team members.",
                )}
              />
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {permissions.map((permission) => (
                  <div
                    key={permission.id}
                    className="flex items-center justify-between rounded-xl border border-line bg-raised/40 px-3 py-2"
                  >
                    <div>
                      <p className="text-[12px] font-semibold text-ink">
                        {permission.user?.name || permission.user?.email || permission.userId}
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{permission.accessLevel}</p>
                    </div>
                    <button
                      type="button"
                      disabled={permissionActionBusy}
                      onClick={() => revokePermission(permission.userId)}
                      className="text-[11px] font-semibold text-rose-600 hover:underline dark:text-rose-400 disabled:opacity-50"
                    >
                      {ctx.t("إزالة", "Remove")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      </Card>
    );
  }

  return (
    <div className="screen-container-wide space-y-6">
      <ScreenHeader
        title={ctx.t("المستندات والمعرفة", "Docs & Wiki")}
        description={ctx.t(
          "أنشئ قاعدة المعرفة الخاصة بفريقك وشارك التوثيق وحوّل الملاحظات لمهام.",
          "Build team wiki, share living documentation, and convert notes into tasks.",
        )}
        actions={
          ctx.can("documents.manage") ? (
            <Btn variant="glow" onClick={() => ctx.setShowNewDoc(true)}>
              <IconPlus size={15} />
              {ctx.t("مستند جديد", "New Doc")}
            </Btn>
          ) : undefined
        }
      />

      <div className="space-y-2">
        {flattenDocumentTree(ctx.docs).map(({ document: d, depth }) => (
          <button
            key={d.id}
            type="button"
            onClick={() => ctx.setActiveDoc(d)}
            className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-start shadow-sm transition hover:bg-raised/50"
            style={{ paddingInlineStart: `${16 + Math.min(depth, 9) * 24}px` }}
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-accent/10 text-[18px]">
              {d.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-ink group-hover:text-accent">{d.title}</div>
              <div className="mt-1 text-[11.5px] text-ink-faint">
                {d.updatedAt ? fmtDate(d.updatedAt, ctx.locale) : ""} • {d.author?.name}
                {depth > 0 ? ` • ${ctx.t("صفحة فرعية", "Subpage")}` : ""}
              </div>
            </div>
            <span className="rounded-full bg-raised px-2.5 py-1 text-[10px] font-bold uppercase text-ink-faint">
              {d.accessLevel ?? "viewer"}
            </span>
            <IconChevron
              size={15}
              className="text-ink-faint transition group-hover:translate-x-1 group-hover:text-accent rtl:rotate-180 rtl:group-hover:-translate-x-1"
            />
          </button>
        ))}
      </div>

      {ctx.docs.length === 0 && (
        <Card className="bg-surface">
          <ScreenState
            framed={false}
            tone="empty"
            title={ctx.t("لا مستندات بعد", "No docs yet")}
            description={ctx.t(
              "أنشئ قاعدة المعرفة الخاصة بفريقك وحول الفقرات إلى مهام بسهولة.",
              "Build your team knowledge base and turn text into actionable tasks.",
            )}
            action={
              ctx.can("documents.manage") ? (
                <Btn variant="glow" onClick={() => ctx.setShowNewDoc(true)}>
                  <IconPlus size={14} />
                  {ctx.t("إنشاء أول مستند", "Create first doc")}
                </Btn>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  );
}
