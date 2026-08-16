"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Btn, Field, Modal, ScreenHeader, ScreenState, inputCls, selectCls, selectSmCls } from "@/components/ui";
import { IconBoard, IconFolder, IconList, IconMore, IconPlus, IconSearch } from "@/components/icons";
import type { Project, ViewCtx } from "@/lib/types";
import { fmtNumber } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  filterAndSortProjects,
  type ProjectSortOption as SortOption,
  type ProjectStatusFilter as StatusFilter,
} from "./projects-model";

type ProjectStatus = Project["status"];
type ViewMode = "list" | "grid";

const statuses: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "archived"];

function statusLabel(status: ProjectStatus, t: ViewCtx["t"]) {
  const labels: Record<ProjectStatus, [string, string]> = {
    planning: ["تخطيط", "Planning"],
    active: ["نشط", "Active"],
    on_hold: ["متوقف مؤقتاً", "On Hold"],
    completed: ["مكتمل", "Completed"],
    archived: ["مؤرشف", "Archived"],
  };
  return t(...labels[status]);
}

function statusTone(status: ProjectStatus): "neutral" | "indigo" | "amber" | "emerald" {
  if (status === "completed") return "emerald";
  if (status === "active") return "indigo";
  if (status === "on_hold") return "amber";
  return "neutral";
}

function normalizedProgress(progress: number) {
  return Math.max(0, Math.min(100, Math.round(progress || 0)));
}

function progressLabel(project: Project, locale: ViewCtx["locale"]) {
  return `${fmtNumber(normalizedProgress(project.progress), locale)}%`;
}

function projectIcon(project: Project, size = 16) {
  if (!project.icon || project.icon === "folder") return <IconFolder size={size} />;
  return (
    <span className="max-w-full truncate px-0.5 leading-none" style={{ fontSize: size }}>
      {project.icon}
    </span>
  );
}

function ProjectIconTile({ project, size = 18 }: { project: Project; size?: number }) {
  return (
    <div
      className="grid place-items-center rounded-xl bg-accent-soft text-accent shadow-sm"
      style={{ width: size + 16, height: size + 16, backgroundColor: project.color }}
    >
      {projectIcon(project, size)}
    </div>
  );
}

function displayDate(value: string | null | undefined, locale: ViewCtx["locale"], fallback: string) {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-u-nu-latn" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function isoDateFromForm(value: FormDataEntryValue | null) {
  const date = String(value ?? "");
  return date ? new Date(`${date}T00:00:00.000Z`).toISOString() : null;
}

function ProjectActions({
  project,
  ctx,
  busy,
  onEdit,
  onDelete,
  onAction,
}: {
  project: Project;
  ctx: ViewCtx;
  busy: boolean;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onAction: (action: "archive" | "restore", project: Project) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const itemClass =
    "w-full rounded-lg px-3 py-2 text-start text-[12.5px] text-ink-soft transition hover:bg-raised hover:text-ink";
  const openProject = (proj: Project) => {
    ctx.switchProject(proj);
    ctx.setActiveView("table");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label={ctx.t(`إجراءات ${project.name}`, `Actions for ${project.name}`)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-faint transition hover:bg-raised hover:text-ink disabled:opacity-50"
      >
        <IconMore size={16} />
      </button>
      {open && (
        <div
          role="menu"
          className="animate-pop absolute end-0 top-9 z-50 w-44 rounded-xl border border-line bg-surface p-1.5 shadow-xl"
        >
          <button type="button" role="menuitem" onClick={() => openProject(project)} className={itemClass}>
            {ctx.t("فتح", "Open")}
          </button>
          {ctx.can("projects.update") && project.status !== "archived" && (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(project);
                setOpen(false);
              }}
              className={itemClass}
            >
              {ctx.t("تعديل", "Edit")}
            </button>
          )}
          {ctx.can("projects.delete") && project.status !== "archived" && (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                void onAction("archive", project);
              }}
              className={itemClass}
            >
              {ctx.t("أرشفة", "Archive")}
            </button>
          )}
          {ctx.can("projects.delete") && project.status === "archived" && (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                void onAction("restore", project);
              }}
              className={itemClass}
            >
              {ctx.t("استعادة", "Restore")}
            </button>
          )}
          {ctx.can("projects.delete") && (
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(project);
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-start text-[12.5px] font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
              >
                {ctx.t("حذف", "Delete")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectsView({ ctx }: { ctx: ViewCtx }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOption>("updated");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("calmboard-projects-view-mode");
    if (saved === "list" || saved === "grid") setViewMode(saved);
  }, []);
  useEffect(() => window.localStorage.setItem("calmboard-projects-view-mode", viewMode), [viewMode]);

  const visibleProjects = useMemo(() => {
    return filterAndSortProjects(ctx.projects, { search, status, sort, locale: ctx.locale });
  }, [ctx.locale, ctx.projects, search, sort, status]);

  const openProject = (project: Project) => {
    ctx.switchProject(project);
    ctx.setActiveView("table");
  };

  const runProjectAction = async (action: "archive" | "restore", project: Project) => {
    setBusyProjectId(project.id);
    setActionError(null);
    try {
      if (action === "archive") await ctx.archiveProject(project);
      else await ctx.restoreProject(project);
    } catch {
      const message = ctx.t("تعذر تنفيذ الإجراء على المشروع. حاول مجدداً.", "The action failed. Please try again.");
      setActionError(message);
      ctx.notify(message, "error");
    } finally {
      setBusyProjectId(null);
    }
  };

  const ownerName = (project: Project) =>
    ctx.users.find((user) => user.id === (project.managerId ?? project.ownerId))?.name ??
    ctx.t("غير معيّن", "Unassigned");
  const noValue = ctx.t("—", "—");

  return (
    <div className="screen-container-wide space-y-5">
      <ScreenHeader
        title={ctx.t("المشاريع", "Projects")}
        description={ctx.t(
          "إدارة مشاريع مساحة العمل الحالية ومتابعة تقدمها.",
          "Manage and track projects in the current workspace.",
        )}
        actions={
          ctx.can("projects.create") ? (
            <Btn variant="glow" onClick={() => ctx.setShowAddProject?.(true)}>
              <IconPlus size={15} />
              {ctx.t("مشروع جديد", "New Project")}
            </Btn>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sm lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{ctx.t("البحث في المشاريع", "Search projects")}</span>
          <IconSearch className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={ctx.t("ابحث بالاسم أو الوصف…", "Search by name or description…")}
            className={`${inputCls} ps-9`}
          />
        </label>
        <div
          className="flex min-w-0 gap-2 overflow-x-auto pb-1 lg:pb-0"
          role="group"
          aria-label={ctx.t("تصفية الحالة", "Status filter")}
        >
          {(["all", ...statuses] as StatusFilter[]).map((value) => (
            <button
              type="button"
              key={value}
              onClick={() => setStatus(value)}
              aria-pressed={status === value}
              className={cn(
                "shrink-0 rounded-lg px-3 py-2 text-[11.5px] font-medium transition",
                status === value ? "bg-accent text-white" : "bg-raised text-ink-soft hover:text-ink",
              )}
            >
              {value === "all" ? ctx.t("الكل", "All") : statusLabel(value, ctx.t)}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as SortOption)}
          className={`${selectSmCls} w-auto min-w-[130px]`}
          aria-label={ctx.t("ترتيب المشاريع", "Sort projects")}
        >
          <option value="name">{ctx.t("الاسم", "Name")}</option>
          <option value="created">{ctx.t("تاريخ الإنشاء", "Created date")}</option>
          <option value="updated">{ctx.t("الأحدث تحديثاً", "Recently updated")}</option>
          <option value="progress">{ctx.t("التقدم", "Progress")}</option>
          <option value="start">{ctx.t("تاريخ البدء", "Start date")}</option>
          <option value="end">{ctx.t("تاريخ الانتهاء", "End date")}</option>
        </select>
        <div
          className="flex shrink-0 rounded-lg bg-raised p-1"
          role="group"
          aria-label={ctx.t("طريقة العرض", "View mode")}
        >
          <button
            type="button"
            aria-label={ctx.t("عرض قائمة", "List view")}
            aria-pressed={viewMode === "list"}
            onClick={() => setViewMode("list")}
            className={cn("rounded-md p-2", viewMode === "list" ? "bg-surface text-ink shadow-sm" : "text-ink-faint")}
          >
            <IconList size={14} />
          </button>
          <button
            type="button"
            aria-label={ctx.t("عرض شبكة", "Grid view")}
            aria-pressed={viewMode === "grid"}
            onClick={() => setViewMode("grid")}
            className={cn("rounded-md p-2", viewMode === "grid" ? "bg-surface text-ink shadow-sm" : "text-ink-faint")}
          >
            <IconBoard size={14} />
          </button>
        </div>
      </div>

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-[12.5px] text-rose-700 dark:text-rose-300"
        >
          {actionError}
        </div>
      )}

      {ctx.workspaceDataError && (
        <ScreenState
          tone="error"
          icon={<IconFolder className="text-rose-500" size={24} />}
          title={ctx.t("تعذر تحميل المشاريع", "Failed to load projects")}
          description={ctx.workspaceDataError}
        />
      )}

      {!ctx.workspaceDataError &&
        (!ctx.projects.length ? (
          <EmptyProjects ctx={ctx} search={false} />
        ) : !visibleProjects.length ? (
          <EmptyProjects ctx={ctx} search />
        ) : viewMode === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((project) => (
              <article
                key={project.id}
                onClick={() => openProject(project)}
                className="group cursor-pointer rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:border-accent/30 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <ProjectIconTile project={project} size={18} />
                  <ProjectActions
                    project={project}
                    ctx={ctx}
                    busy={busyProjectId === project.id}
                    onEdit={setEditingProject}
                    onDelete={setProjectToDelete}
                    onAction={runProjectAction}
                  />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProject(project);
                    }}
                    className="min-w-0 flex-1 truncate text-start text-[14px] font-semibold text-ink hover:text-accent hover:underline focus-ring"
                  >
                    {project.name}
                  </button>
                  <Badge tone={statusTone(project.status)}>{statusLabel(project.status, ctx.t)}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 min-h-10 text-[12px] leading-relaxed text-ink-faint">
                  {project.description || ctx.t("لا يوجد وصف للمشروع.", "No project description.")}
                </p>
                <div className="mt-5 flex items-center justify-between text-[11px] text-ink-soft">
                  <span>{ctx.t("التقدم", "Progress")}</span>
                  <span>{progressLabel(project, ctx.locale)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${normalizedProgress(project.progress)}%` }}
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[11px] text-ink-faint">
                  <div>
                    <div>{ctx.t("المهام", "Tasks")}</div>
                    <div className="mt-0.5 font-semibold text-ink-soft">
                      {fmtNumber(project.completedTasks ?? 0, ctx.locale)} /{" "}
                      {fmtNumber(project.totalTasks ?? 0, ctx.locale)}
                    </div>
                  </div>
                  <div>
                    <div>{ctx.t("المسؤول", "Owner")}</div>
                    <div className="mt-0.5 truncate font-semibold text-ink-soft">{ownerName(project)}</div>
                  </div>
                  <div>
                    <div>{ctx.t("الأعضاء", "Members")}</div>
                    <div className="mt-0.5 font-semibold text-ink-soft">
                      {fmtNumber(project.memberCount ?? 0, ctx.locale)}
                    </div>
                  </div>
                  <div>
                    <div>{ctx.t("الانتهاء", "End date")}</div>
                    <div className="mt-0.5 font-semibold text-ink-soft">
                      {displayDate(project.endDate, ctx.locale, noValue)}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {visibleProjects.map((project) => (
                <article
                  key={project.id}
                  onClick={() => openProject(project)}
                  className="card p-4 transition-all duration-200 hover:border-line-strong hover:shadow-md cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProjectIconTile project={project} size={16} />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProject(project);
                          }}
                          className="truncate text-start text-[14px] font-semibold text-ink hover:text-accent focus-ring"
                        >
                          {project.name}
                        </button>
                        <div className="truncate text-[11px] text-ink-faint">
                          {project.description || ctx.t("بدون وصف", "No description")}
                        </div>
                      </div>
                    </div>
                    <ProjectActions
                      project={project}
                      ctx={ctx}
                      busy={busyProjectId === project.id}
                      onEdit={setEditingProject}
                      onDelete={setProjectToDelete}
                      onAction={runProjectAction}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line/60 pt-3">
                    <Badge tone={statusTone(project.status)}>{statusLabel(project.status, ctx.t)}</Badge>
                    <span className="text-[11px] text-ink-soft">{progressLabel(project, ctx.locale)}</span>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-sm md:block">
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-[760px] text-start text-[12.5px]">
                  <thead className="border-b border-line bg-raised/60 text-[11px] text-ink-faint">
                    <tr>
                      <th className="px-4 py-3 text-start font-semibold">{ctx.t("المشروع", "Project")}</th>
                      <th className="px-4 py-3 text-start font-semibold">{ctx.t("الحالة", "Status")}</th>
                      <th className="px-4 py-3 text-start font-semibold">{ctx.t("التقدم", "Progress")}</th>
                      <th className="hidden px-4 py-3 text-start font-semibold md:table-cell">
                        {ctx.t("المهام", "Tasks")}
                      </th>
                      <th className="hidden px-4 py-3 text-start font-semibold lg:table-cell">
                        {ctx.t("المسؤول", "Owner")}
                      </th>
                      <th className="hidden px-4 py-3 text-start font-semibold xl:table-cell">
                        {ctx.t("الفترة", "Dates")}
                      </th>
                      <th className="w-12 px-3 py-3">
                        <span className="sr-only">{ctx.t("الإجراءات", "Actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visibleProjects.map((project) => (
                      <tr
                        key={project.id}
                        onClick={() => openProject(project)}
                        className="cursor-pointer transition hover:bg-raised/60"
                      >
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <ProjectIconTile project={project} size={14} />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openProject(project);
                                }}
                                className="max-w-64 truncate text-start font-semibold text-ink hover:text-accent hover:underline focus-ring"
                              >
                                {project.name}
                              </button>
                              <div className="max-w-64 truncate text-[11px] text-ink-faint">
                                {project.description || ctx.t("بدون وصف", "No description")}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={statusTone(project.status)}>{statusLabel(project.status, ctx.t)}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-raised">
                              <div
                                className="h-full bg-accent"
                                style={{ width: `${normalizedProgress(project.progress)}%` }}
                              />
                            </div>
                            <span className="tabular-nums text-ink-soft">{progressLabel(project, ctx.locale)}</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-ink-soft md:table-cell">
                          {fmtNumber(project.completedTasks ?? 0, ctx.locale)} /{" "}
                          {fmtNumber(project.totalTasks ?? 0, ctx.locale)}
                        </td>
                        <td className="hidden max-w-40 truncate px-4 py-3 text-ink-soft lg:table-cell">
                          {ownerName(project)} · {fmtNumber(project.memberCount ?? 0, ctx.locale)}
                        </td>
                        <td className="hidden whitespace-nowrap px-4 py-3 text-[11px] text-ink-faint xl:table-cell">
                          {displayDate(project.startDate, ctx.locale, noValue)} —{" "}
                          {displayDate(project.endDate, ctx.locale, noValue)}
                        </td>
                        <td className="px-3 py-3">
                          <ProjectActions
                            project={project}
                            ctx={ctx}
                            busy={busyProjectId === project.id}
                            onEdit={setEditingProject}
                            onDelete={setProjectToDelete}
                            onAction={runProjectAction}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ))}

      <EditProjectModal
        project={editingProject}
        ctx={ctx}
        busy={busyProjectId === editingProject?.id}
        onClose={() => setEditingProject(null)}
        onSave={async (project, patch) => {
          setBusyProjectId(project.id);
          setActionError(null);
          try {
            await ctx.updateProject(project, patch);
            setEditingProject(null);
          } catch {
            const message = ctx.t("تعذر تحديث المشروع. حاول مجدداً.", "Failed to update project. Please try again.");
            setActionError(message);
            ctx.notify(message, "error");
          } finally {
            setBusyProjectId(null);
          }
        }}
      />

      <Modal
        open={Boolean(projectToDelete)}
        onClose={() => !busyProjectId && setProjectToDelete(null)}
        title={ctx.t("حذف المشروع", "Delete Project")}
      >
        {projectToDelete && (
          <div className="space-y-5">
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
              <div className="font-semibold text-rose-700 dark:text-rose-300">{projectToDelete.name}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-rose-700/80 dark:text-rose-200/80">
                {ctx.t(
                  "سيُحذف المشروع حذفاً مرناً ويختفي من القوائم العادية. لا يمكن التراجع عنه من هذه الشاشة.",
                  "The project will be soft-deleted and removed from normal lists. It cannot be restored from this screen.",
                )}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Btn variant="outline" disabled={Boolean(busyProjectId)} onClick={() => setProjectToDelete(null)}>
                {ctx.t("إلغاء", "Cancel")}
              </Btn>
              <Btn
                variant="danger"
                disabled={Boolean(busyProjectId)}
                onClick={async () => {
                  setBusyProjectId(projectToDelete.id);
                  setActionError(null);
                  try {
                    await ctx.deleteProject(projectToDelete);
                    setProjectToDelete(null);
                  } catch {
                    const message = ctx.t(
                      "تعذر حذف المشروع. حاول مجدداً.",
                      "Failed to delete project. Please try again.",
                    );
                    setActionError(message);
                    ctx.notify(message, "error");
                  } finally {
                    setBusyProjectId(null);
                  }
                }}
              >
                {busyProjectId ? ctx.t("جارٍ الحذف…", "Deleting…") : ctx.t("تأكيد الحذف", "Confirm Delete")}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function EmptyProjects({ ctx, search }: { ctx: ViewCtx; search: boolean }) {
  return (
    <ScreenState
      tone="empty"
      icon={<IconFolder className="text-ink-faint" size={24} />}
      title={
        search ? ctx.t("لا توجد نتائج مطابقة", "No matching projects") : ctx.t("لا توجد مشاريع", "No projects yet")
      }
      description={
        search
          ? ctx.t("غيّر عبارة البحث أو مرشح الحالة.", "Change the search term or status filter.")
          : ctx.t("أنشئ أول مشروع لبدء تنظيم العمل.", "Create the first project to organize the work.")
      }
      action={
        !search && ctx.can("projects.create") ? (
          <Btn variant="glow" onClick={() => ctx.setShowAddProject?.(true)}>
            <IconPlus size={15} />
            {ctx.t("مشروع جديد", "New Project")}
          </Btn>
        ) : undefined
      }
    />
  );
}

function EditProjectModal({
  project,
  ctx,
  busy,
  onClose,
  onSave,
}: {
  project: Project | null;
  ctx: ViewCtx;
  busy: boolean;
  onClose: () => void;
  onSave: (project: Project, patch: Partial<Project>) => Promise<void>;
}) {
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValidationError(null);
  }, [project]);

  return (
    <Modal
      open={Boolean(project)}
      onClose={() => !busy && onClose()}
      title={ctx.t("تعديل المشروع", "Edit Project")}
      wide
    >
      {project && (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setValidationError(null);
            const form = new FormData(event.currentTarget);
            const startDate = isoDateFromForm(form.get("startDate"));
            const endDate = isoDateFromForm(form.get("endDate"));
            const progress = Number(form.get("progress"));

            if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
              setValidationError(
                ctx.t("يجب ألا يسبق تاريخ الانتهاء تاريخ البدء.", "End date cannot be earlier than start date."),
              );
              return;
            }

            if (progress < 0 || progress > 100) {
              setValidationError(ctx.t("يجب أن تكون نسبة التقدم بين 0 و 100.", "Progress must be between 0 and 100."));
              return;
            }

            void onSave(project, {
              name: String(form.get("name") ?? "").trim(),
              description: String(form.get("description") ?? "").trim() || null,
              status: String(form.get("status")) as ProjectStatus,
              priority: String(form.get("priority")),
              progress,
              color: String(form.get("color")),
              startDate,
              endDate,
              ownerId: String(form.get("ownerId") ?? "") || null,
              managerId: String(form.get("managerId") ?? "") || null,
            });
          }}
        >
          {validationError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-300 sm:col-span-2"
            >
              {validationError}
            </div>
          )}

          <Field label={ctx.t("الاسم", "Name")}>
            <input name="name" required maxLength={255} defaultValue={project.name} className={inputCls} />
          </Field>
          <Field label={ctx.t("الحالة", "Status")}>
            <select name="status" defaultValue={project.status} className={selectCls}>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {statusLabel(value, ctx.t)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label={ctx.t("الوصف", "Description")}>
              <textarea
                name="description"
                rows={4}
                maxLength={100000}
                defaultValue={project.description ?? ""}
                className={`${inputCls} h-auto py-2`}
              />
            </Field>
          </div>
          <Field label={ctx.t("الأولوية", "Priority")}>
            <select name="priority" defaultValue={project.priority} className={selectCls}>
              <option value="low">{ctx.t("منخفضة", "Low")}</option>
              <option value="medium">{ctx.t("متوسطة", "Medium")}</option>
              <option value="high">{ctx.t("مرتفعة", "High")}</option>
              <option value="urgent">{ctx.t("عاجلة", "Urgent")}</option>
            </select>
          </Field>
          <Field label={ctx.t("التقدم", "Progress")}>
            <input
              name="progress"
              type="number"
              min={0}
              max={100}
              defaultValue={project.progress}
              className={inputCls}
            />
          </Field>
          <Field label={ctx.t("تاريخ البدء", "Start date")}>
            <input
              name="startDate"
              type="date"
              defaultValue={project.startDate?.slice(0, 10) ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label={ctx.t("تاريخ الانتهاء", "End date")}>
            <input name="endDate" type="date" defaultValue={project.endDate?.slice(0, 10) ?? ""} className={inputCls} />
          </Field>
          <Field label={ctx.t("المالك", "Owner")}>
            <select name="ownerId" defaultValue={project.ownerId ?? ""} className={selectCls}>
              <option value="">{ctx.t("غير معيّن", "Unassigned")}</option>
              {ctx.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={ctx.t("المدير", "Manager")}>
            <select name="managerId" defaultValue={project.managerId ?? ""} className={selectCls}>
              <option value="">{ctx.t("غير معيّن", "Unassigned")}</option>
              {ctx.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={ctx.t("اللون", "Color")}>
            <input name="color" type="color" defaultValue={project.color || "#6366f1"} className="h-10 w-full" />
          </Field>
          <div className="flex items-end justify-end gap-2 sm:col-span-2">
            <Btn type="button" variant="outline" disabled={busy} onClick={onClose}>
              {ctx.t("إلغاء", "Cancel")}
            </Btn>
            <Btn type="submit" disabled={busy}>
              {busy ? ctx.t("جارٍ الحفظ…", "Saving…") : ctx.t("حفظ التغييرات", "Save Changes")}
            </Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}
