"use client";

import { useMemo, useState } from "react";
import { Btn, Field, Modal, ScreenHeader, ScreenState, inputCls } from "@/components/ui";
import { EntityIcon } from "@/components/entity-icon";
import { IconPicker } from "@/components/icon-picker";
import { IconCheck, IconFolder, IconPlus, IconSearch, IconSettings, IconUsers } from "@/components/icons";
import type { ViewCtx, Workspace } from "@/lib/types";

export function WorkspacesView({ ctx }: { ctx: ViewCtx }) {
  const [search, setSearch] = useState("");
  const [workspaceToEdit, setWorkspaceToEdit] = useState<Workspace | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string | null>(null);

  const normalizedSearch = search.trim().toLocaleLowerCase(ctx.locale);
  const visibleWorkspaces = useMemo(
    () =>
      ctx.workspaces.filter((workspace) => {
        if (!normalizedSearch) return true;
        return `${workspace.name} ${workspace.description ?? ""}`
          .toLocaleLowerCase(ctx.locale)
          .includes(normalizedSearch);
      }),
    [ctx.locale, ctx.workspaces, normalizedSearch],
  );

  const openWorkspace = async (workspace: Workspace, view?: "settings" | "members") => {
    setPendingWorkspaceId(workspace.id);
    try {
      await ctx.switchWorkspace(workspace);
      ctx.setActiveView(view ?? "projects");
    } catch {
      ctx.notify(ctx.t("تعذر فتح مساحة العمل", "Failed to open workspace"), "error");
    } finally {
      setPendingWorkspaceId(null);
    }
  };

  return (
    <div className="screen-container-wide space-y-6">
      <ScreenHeader
        title={ctx.t("مساحات العمل", "Workspaces")}
        description={ctx.t(
          "تصفح مساحات العمل المتاحة لك وإدارتها.",
          "Browse and manage the workspaces available to you.",
        )}
        actions={
          ctx.can("workspace.manage") ? (
            <Btn variant="glow" onClick={() => ctx.setShowAddWorkspace(true)}>
              <IconPlus size={15} />
              {ctx.t("مساحة عمل جديدة", "New Workspace")}
            </Btn>
          ) : undefined
        }
      />

      <label className="relative block max-w-md">
        <span className="sr-only">{ctx.t("البحث في مساحات العمل", "Search workspaces")}</span>
        <IconSearch className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" size={15} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={ctx.t("ابحث بالاسم أو الوصف…", "Search by name or description…")}
          className={`${inputCls} ps-9`}
        />
      </label>

      {ctx.workspaceDataError ? (
        <ScreenState
          tone="error"
          title={ctx.t("تعذر تحميل مساحات العمل", "Failed to load workspaces")}
          description={ctx.workspaceDataError}
        />
      ) : visibleWorkspaces.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleWorkspaces.map((workspace) => {
            const current = workspace.id === ctx.activeWorkspace?.id;
            return (
              <article key={workspace.id} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-start gap-3">
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-raised text-accent shadow-sm"
                    style={{ backgroundColor: workspace.color || "#6366f1" }}
                  >
                    <EntityIcon value={workspace.icon} fallback="workspace" size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-[14px] font-semibold text-ink">{workspace.name}</h2>
                      {current && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          <IconCheck size={11} />
                          {ctx.t("الحالية", "Current")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-relaxed text-ink-faint">
                      {workspace.description || ctx.t("لا يوجد وصف لمساحة العمل.", "No workspace description.")}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                  <Btn
                    size="sm"
                    disabled={pendingWorkspaceId !== null}
                    aria-busy={pendingWorkspaceId === workspace.id}
                    onClick={() => void openWorkspace(workspace)}
                  >
                    {current ? ctx.t("فتح", "Open") : ctx.t("تبديل وفتح", "Switch & Open")}
                  </Btn>
                  {ctx.can("workspace.manage") && (
                    <>
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={pendingWorkspaceId !== null}
                        onClick={() => {
                          setEditError(null);
                          setWorkspaceToEdit(workspace);
                        }}
                      >
                        {ctx.t("تعديل", "Edit")}
                      </Btn>
                      <Btn
                        size="sm"
                        variant="outline"
                        disabled={pendingWorkspaceId !== null}
                        aria-busy={pendingWorkspaceId === workspace.id}
                        onClick={() => void openWorkspace(workspace, "settings")}
                      >
                        <IconSettings size={13} />
                        {ctx.t("الإعدادات", "Settings")}
                      </Btn>
                    </>
                  )}
                  <Btn
                    size="sm"
                    variant="outline"
                    disabled={pendingWorkspaceId !== null}
                    aria-busy={pendingWorkspaceId === workspace.id}
                    onClick={() => void openWorkspace(workspace, "members")}
                  >
                    <IconUsers size={13} />
                    {ctx.t("الأعضاء", "Members")}
                  </Btn>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <ScreenState
          tone="empty"
          title={search ? ctx.t("لا توجد نتائج", "No results") : ctx.t("لا توجد مساحات عمل", "No workspaces")}
          description={
            search
              ? ctx.t("جرّب عبارة بحث أخرى.", "Try a different search term.")
              : ctx.t("لا توجد مساحة عمل متاحة لهذا الحساب.", "No workspace is available to this account.")
          }
        />
      )}

      <Modal
        open={Boolean(workspaceToEdit)}
        onClose={() => !saving && setWorkspaceToEdit(null)}
        title={ctx.t("تعديل مساحة العمل", "Edit Workspace")}
      >
        {workspaceToEdit && (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setSaving(true);
              setEditError(null);
              try {
                await ctx.updateWorkspace(
                  {
                    name: String(form.get("name") ?? "").trim(),
                    description: String(form.get("description") ?? "").trim() || null,
                    color: String(form.get("color") ?? "#6366f1"),
                    icon: String(form.get("icon") ?? workspaceToEdit.icon ?? "briefcase"),
                  },
                  workspaceToEdit,
                );
                setWorkspaceToEdit(null);
              } catch {
                setEditError(ctx.t("تعذر تحديث مساحة العمل. حاول مجدداً.", "Failed to update workspace. Try again."));
              } finally {
                setSaving(false);
              }
            }}
          >
            {editError && (
              <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                {editError}
              </p>
            )}
            <Field label={ctx.t("الاسم", "Name")}>
              <input name="name" required maxLength={255} defaultValue={workspaceToEdit.name} className={inputCls} />
            </Field>
            <Field label={ctx.t("الوصف", "Description")}>
              <textarea
                name="description"
                rows={4}
                defaultValue={workspaceToEdit.description ?? ""}
                className={`${inputCls} h-auto py-2`}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={ctx.t("اللون", "Color")}>
                <div className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3">
                  <input
                    name="color"
                    type="color"
                    defaultValue={workspaceToEdit.color || "#6366f1"}
                    className="h-5 w-5 shrink-0 cursor-pointer rounded-full border-0 bg-transparent outline-none"
                  />
                  <span className="truncate text-[13px] text-ink-soft">{ctx.t("اختر اللون", "Pick a color")}</span>
                </div>
              </Field>
              <Field label={ctx.t("الأيقونة", "Icon")}>
                <IconPicker
                  name="icon"
                  defaultValue={workspaceToEdit.icon || "briefcase"}
                  fallback="workspace"
                  t={ctx.t}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Btn type="button" variant="outline" disabled={saving} onClick={() => setWorkspaceToEdit(null)}>
                {ctx.t("إلغاء", "Cancel")}
              </Btn>
              <Btn type="submit" disabled={saving} aria-busy={saving}>
                {saving ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("حفظ", "Save")}
              </Btn>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
