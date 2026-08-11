"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Workspace, Organization } from "@/lib/types";
import { LogoMark, IconCollapse, IconSearch, IconPlus, IconCheck, IconChevron } from "@/components/icons";
import { Badge } from "@/components/ui";

type WorkspaceSwitcherDropdownProps = {
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  switchWorkspace: (w: Workspace) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  onAddWorkspace: () => void;
  canManageWorkspace: boolean;
  t: (ar: string, en: string) => string;
};

export function WorkspaceSwitcherDropdown({
  activeOrg,
  activeWorkspace,
  workspaces,
  switchWorkspace,
  collapsed,
  setCollapsed,
  onAddWorkspace,
  canManageWorkspace,
  t,
}: WorkspaceSwitcherDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredWorkspaces = workspaces.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  // Close when clicking outside or pressing Escape
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
        setFocusedIndex((prev) => Math.min(prev + 1, filteredWorkspaces.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredWorkspaces[focusedIndex]) {
          switchWorkspace(filteredWorkspaces[focusedIndex]);
          setOpen(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    // Auto-focus search input when opened
    const timeout = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeout);
    };
  }, [open, filteredWorkspaces, focusedIndex, switchWorkspace]);

  // Scroll focused item into view
  useEffect(() => {
    if (open && listRef.current) {
      const activeElement = listRef.current.children[focusedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [focusedIndex, open]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex h-16 items-center gap-3 border-b border-slate-200/80 dark:border-white/6 px-4">
        <LogoMark size={30} />
        {!collapsed && (
          <button
            onClick={() => setOpen(!open)}
            className="min-w-0 flex-1 rounded-xl p-1.5 text-start hover:bg-slate-100 dark:hover:bg-white/5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-display text-[15px] font-bold tracking-tight text-slate-900 dark:text-white truncate">
                {activeWorkspace ? activeWorkspace.name : "CalmBoard"}
              </span>
              <span className="grid place-items-center h-4 w-4 rounded-md transition-colors text-slate-400 dark:text-zinc-500 shrink-0">
                <IconChevron size={12} className={cn("transition-transform", open ? "-rotate-90" : "rotate-90")} />
              </span>
              {!activeWorkspace && (
                <Badge tone="cyan" className="px-1.5! text-[9px]!">
                  2.0
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-500 dark:text-zinc-500">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0" />
              <span className="truncate">{activeOrg?.name || t("الرئيسية", "Home")}</span>
            </div>
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 dark:text-zinc-500 dark:hover:bg-white/6 dark:hover:text-white"
        >
          <IconCollapse size={14} />
        </button>
      </div>

      {open && !collapsed && (
        <div className="absolute top-14 left-4 right-4 z-50 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#1a1a24] dark:shadow-[0_8px_40px_rgba(0,0,0,0.4)] animate-pop">
          <div className="p-2 border-b border-slate-100 dark:border-white/5 flex items-center gap-2 px-3">
            <IconSearch size={14} className="text-slate-400 dark:text-zinc-500 shrink-0" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setFocusedIndex(0);
              }}
              placeholder={t("ابحث عن مساحة عمل...", "Search workspaces...")}
              className="w-full bg-transparent text-[13px] outline-none text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 h-8"
            />
          </div>

          <div ref={listRef} className="max-h-60 overflow-y-auto p-1.5 scrollbar-thin">
            {filteredWorkspaces.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-slate-500 dark:text-zinc-500">
                {t("لا توجد نتائج", "No workspaces found")}
              </div>
            ) : (
              filteredWorkspaces.map((w, i) => (
                <button
                  key={w.id}
                  onClick={() => {
                    switchWorkspace(w);
                    setOpen(false);
                  }}
                  onMouseEnter={() => setFocusedIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors text-start",
                    focusedIndex === i
                      ? "bg-slate-100 text-slate-900 dark:bg-white/5 dark:text-white"
                      : "text-slate-700 dark:text-zinc-300",
                    activeWorkspace?.id === w.id &&
                      "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300 font-medium",
                  )}
                  role="option"
                  aria-selected={activeWorkspace?.id === w.id}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: w.color }} />
                  <span className="truncate flex-1">{w.name}</span>
                  {activeWorkspace?.id === w.id && (
                    <IconCheck size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {canManageWorkspace && (
            <div className="border-t border-slate-100 dark:border-white/5 p-1.5 bg-slate-50 dark:bg-black/20">
              <button
                onClick={() => {
                  onAddWorkspace();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-white transition-colors text-start"
              >
                <IconPlus size={14} className="shrink-0" />
                {t("إضافة مساحة عمل", "Add Workspace")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
