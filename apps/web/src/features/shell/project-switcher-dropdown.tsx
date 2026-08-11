"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Project, Workspace, Organization } from "@/lib/types";
import { IconFolder, IconSearch, IconPlus, IconCheck, IconChevron } from "@/components/icons";

type ProjectSwitcherDropdownProps = {
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  activeProject: Project | null;
  projects: Project[];
  switchProject: (p: Project) => void;
  onAddProject: () => void;
  canCreateProject: boolean;
  stats: { total: number; progress: number };
  t: (ar: string, en: string) => string;
};

export function ProjectSwitcherDropdown({
  activeOrg,
  activeWorkspace,
  activeProject,
  projects,
  switchProject,
  onAddProject,
  canCreateProject,
  stats,
  t,
}: ProjectSwitcherDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredProjects = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (!open) {
      setSearch("");
      setFocusedIndex(0);
      return;
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredProjects.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredProjects[focusedIndex]) {
          switchProject(filteredProjects[focusedIndex]);
          setOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    const timeout = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeout);
    };
  }, [open, filteredProjects, focusedIndex, switchProject]);

  useEffect(() => {
    if (open && listRef.current) {
      const activeElement = listRef.current.children[focusedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex, open]);

  useEffect(() => {
    setOpen(false);
  }, [activeWorkspace?.id]);

  const titleText = activeProject?.name || activeWorkspace?.name || t("اختر مشروعاً", "Select a project");
  const subtitleText = activeProject ? activeWorkspace?.name : activeOrg?.name;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="group flex min-w-0 max-w-[240px] flex-1 items-center gap-2.5 rounded-xl p-1.5 text-start transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:bg-white/5 sm:min-w-[200px]"
      >
        <div className="relative">
          <div
            className="absolute inset-0 blur-md opacity-40 mix-blend-multiply dark:mix-blend-screen"
            style={{ background: activeProject?.color || activeWorkspace?.color || "#6366f1" }}
          />
          <span
            className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl text-white shadow-sm ring-1 ring-white/20 dark:ring-white/10 overflow-hidden"
            style={{ background: activeProject?.color || activeWorkspace?.color || "#6366f1" }}
          >
            {activeProject?.icon ? (
              <span className="text-[14px] truncate px-1 max-w-full text-center">
                {activeProject.icon.length > 3 ? activeProject.icon.substring(0, 2) : activeProject.icon}
              </span>
            ) : (
              <IconFolder size={14} />
            )}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate text-[13.5px] font-semibold text-ink">
            <span className="truncate">{titleText}</span>
            <span className="grid place-items-center h-4 w-4 rounded-md transition-colors text-ink-soft group-hover:bg-slate-200 dark:group-hover:bg-white/10 shrink-0">
              <IconChevron size={12} className={cn("transition-transform", open ? "-rotate-90" : "rotate-90")} />
            </span>

            {activeProject && (
              <span className="grid h-4 place-items-center rounded-full bg-raised px-1.5 text-[9px] font-bold text-ink-soft border border-line shrink-0 ms-1">
                {stats.progress}%
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 truncate text-[10.5px] text-ink-faint mt-0.5">
            <span className="truncate">{subtitleText}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-ink-faint/50 shrink-0" />
            <span className="shrink-0">
              {stats.total} {t("مهمة", "tasks")}
            </span>
            {activeProject && (
              <div className="ms-1.5 flex h-1 w-12 overflow-hidden rounded-full bg-raised shrink-0">
                <div className="h-full bg-accent transition-all duration-500" style={{ width: `${stats.progress}%` }} />
              </div>
            )}
          </div>
        </div>
      </button>

      {open && (
        <div className="animate-pop absolute start-0 top-14 z-50 w-[min(280px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#1a1a24] dark:shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
          <div className="p-2 border-b border-slate-100 dark:border-white/5 flex items-center gap-2 px-3">
            <IconSearch size={14} className="text-slate-400 dark:text-zinc-500 shrink-0" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setFocusedIndex(0);
              }}
              placeholder={t("ابحث عن مشروع...", "Search projects...")}
              className="w-full bg-transparent text-[13px] outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 h-8"
            />
          </div>

          <div ref={listRef} className="max-h-60 overflow-y-auto p-1.5 scrollbar-thin">
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-slate-500 dark:text-zinc-500">
                {t("لا توجد نتائج", "No projects found")}
              </div>
            ) : (
              filteredProjects.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => {
                    switchProject(p);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setFocusedIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors text-start",
                    focusedIndex === i
                      ? "bg-slate-100 text-slate-900 dark:bg-white/5 dark:text-white"
                      : "text-slate-700 dark:text-zinc-300",
                    activeProject?.id === p.id &&
                      "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium",
                  )}
                  role="option"
                  aria-selected={activeProject?.id === p.id}
                >
                  <span
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-white text-[12px] shadow-sm ring-1 ring-black/10 dark:ring-white/10 overflow-hidden"
                    style={{ background: p.color || "#6366f1" }}
                  >
                    {p.icon ? (
                      <span className="truncate px-1 text-[11px] max-w-full text-center">
                        {p.icon.length > 3 ? p.icon.substring(0, 2) : p.icon}
                      </span>
                    ) : (
                      <IconFolder size={12} />
                    )}
                  </span>
                  <span className="truncate flex-1">{p.name}</span>
                  {activeProject?.id === p.id && (
                    <IconCheck size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {canCreateProject && (
            <div className="border-t border-slate-100 dark:border-white/5 p-1.5 bg-slate-50 dark:bg-black/20">
              <button
                onClick={() => {
                  onAddProject();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white transition-colors text-start"
              >
                <IconPlus size={14} className="shrink-0" />
                {t("إضافة مشروع", "Add Project")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
