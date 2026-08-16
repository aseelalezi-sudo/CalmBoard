"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  setCollapsed?: (v: boolean) => void;
  onLogoClick?: () => void;
  reserveEndSpace?: boolean;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredWorkspaces = workspaces.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()));

  const handleSelectWorkspace = useCallback(
    (w: Workspace) => {
      switchWorkspace(w);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [switchWorkspace],
  );

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
        triggerRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredWorkspaces.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredWorkspaces[focusedIndex]) {
          handleSelectWorkspace(filteredWorkspaces[focusedIndex]);
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
  }, [open, filteredWorkspaces, focusedIndex, handleSelectWorkspace]);

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
      <div className={cn("flex h-16 items-center border-b border-line px-4", collapsed ? "justify-center" : "gap-3")}>
        <LogoMark size={30} />
        {!collapsed && (
          <button
            ref={triggerRef}
            onClick={() => setOpen(!open)}
            className="min-w-0 flex-1 rounded-xl p-1.5 text-start hover:bg-raised transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <div className="flex items-center gap-1.5">
              <span className="font-display text-[15px] font-bold tracking-tight text-ink truncate">
                {activeWorkspace ? activeWorkspace.name : "CalmBoard"}
              </span>
              <span className="grid place-items-center h-4 w-4 rounded-md transition-colors text-ink-soft shrink-0">
                <IconChevron
                  size={12}
                  className={cn("transition-transform duration-200", open ? "-rotate-90" : "rotate-90")}
                />
              </span>
              {!activeWorkspace && (
                <Badge tone="cyan" className="px-1.5! text-[9px]!">
                  2.0
                </Badge>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-faint">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="truncate">{activeOrg?.name || t("الرئيسية", "Home")}</span>
            </div>
          </button>
        )}
      </div>

      {open && !collapsed && (
        <div className="absolute top-15 start-2 end-2 z-50 flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl backdrop-blur-2xl ring-1 ring-line animate-pop">
          <div className="border-b border-line p-2.5">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-raised/60 px-2.5 py-1 text-ink focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20">
              <IconSearch size={14} className="shrink-0 text-ink-faint" />
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setFocusedIndex(0);
                }}
                placeholder={t("ابحث عن مساحة عمل...", "Search workspaces...")}
                className="h-7 w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>

          <div ref={listRef} className="max-h-60 overflow-y-auto p-1.5 scrollbar-thin">
            {filteredWorkspaces.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-ink-faint">
                {t("لا توجد نتائج", "No workspaces found")}
              </div>
            ) : (
              filteredWorkspaces.map((w, i) => (
                <button
                  key={w.id}
                  onClick={() => {
                    handleSelectWorkspace(w);
                  }}
                  onMouseEnter={() => setFocusedIndex(i)}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors text-start",
                    focusedIndex === i ? "bg-raised text-ink" : "text-ink-soft",
                    activeWorkspace?.id === w.id && "bg-accent/15 text-accent font-semibold",
                  )}
                  role="option"
                  aria-selected={activeWorkspace?.id === w.id}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10.5px] font-bold text-white shadow-xs"
                    style={{ background: w.color || "#6366f1" }}
                  >
                    {w.name.charAt(0)}
                  </span>
                  <span className="truncate flex-1 font-medium">{w.name}</span>
                  {activeWorkspace?.id === w.id && <IconCheck size={14} className="text-accent shrink-0" />}
                </button>
              ))
            )}
          </div>

          {canManageWorkspace && (
            <div className="border-t border-line p-1.5 bg-raised/40">
              <button
                onClick={() => {
                  onAddWorkspace();
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-[12.5px] font-semibold text-accent hover:bg-accent/10 transition-colors text-start"
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
