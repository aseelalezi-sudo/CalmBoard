"use client";

import { useEffect, useRef } from "react";
import type { Organization, Workspace } from "@/lib/types";
import { cn } from "@/lib/utils";
import { IconX } from "@/components/icons";
import { NAV_ADMIN, NAV_SPACE, NAV_TOOLS, NAV_WORK, VIEW_TABS } from "@/features/shell/navigation";
import { WorkspaceSwitcherDropdown } from "@/features/shell/workspace-switcher-dropdown";

type MobileNavigationDrawerProps = {
  open: boolean;
  onClose: () => void;
  activeView: string;
  setActiveView: (view: string) => void;
  activeOrg: Organization | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  switchWorkspace: (workspace: Workspace) => void;
  onAddWorkspace: () => void;
  canManageWorkspace: boolean;
  canOpenView: (view: string) => boolean;
  unread: number;
  t: (ar: string, en: string) => string;
};

export function MobileNavigationDrawer({
  open,
  onClose,
  activeView,
  setActiveView,
  activeOrg,
  activeWorkspace,
  workspaces,
  switchWorkspace,
  onAddWorkspace,
  canManageWorkspace,
  canOpenView,
  unread,
  t,
}: MobileNavigationDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const navigate = (view: string) => {
    setActiveView(view);
    onClose();
  };
  const sections = [
    { id: "work", ar: "العمل", en: "Work", items: NAV_WORK },
    { id: "views", ar: "طرق العرض", en: "Views", items: VIEW_TABS },
    { id: "workspace", ar: "مساحة العمل", en: "Workspace", items: NAV_SPACE },
    { id: "tools", ar: "الأدوات", en: "Tools", items: NAV_TOOLS },
    { id: "admin", ar: "الإدارة", en: "Administration", items: NAV_ADMIN },
  ];

  return (
    <div className="fixed inset-0 z-70 h-dvh lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
        onClick={onClose}
        aria-label={t("إغلاق قائمة التنقل", "Close navigation")}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("قائمة التنقل", "Navigation menu")}
        className="animate-slide absolute inset-y-0 start-0 flex w-[min(292px,88vw)] flex-col border-e border-indigo-100/80 bg-linear-to-b from-indigo-50 via-white to-violet-50/60 pb-[env(safe-area-inset-bottom)] shadow-2xl dark:border-indigo-400/10 dark:from-indigo-950/45 dark:via-[#0d0d17] dark:to-violet-950/35 rtl:[--slide-x:24px]"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute end-3 top-4 z-10 grid h-8 w-8 place-items-center rounded-lg text-ink-soft transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label={t("إغلاق قائمة التنقل", "Close navigation")}
        >
          <IconX size={16} />
        </button>

        <WorkspaceSwitcherDropdown
          activeOrg={activeOrg}
          activeWorkspace={activeWorkspace}
          workspaces={workspaces}
          switchWorkspace={(workspace) => {
            switchWorkspace(workspace);
            onClose();
          }}
          collapsed={false}
          onLogoClick={() => {
            navigate("dashboard");
          }}
          reserveEndSpace
          onAddWorkspace={() => {
            onAddWorkspace();
            onClose();
          }}
          canManageWorkspace={canManageWorkspace}
          t={t}
        />

        <div className="flex-1 overflow-y-auto px-2.5 py-3">
          <div className="space-y-4">
            {sections.map((section) => {
              const items = section.items.filter(({ id }) => section.id === "work" || canOpenView(id));
              if (items.length === 0) return null;
              return (
                <nav key={section.id} aria-label={t(section.ar, section.en)}>
                  <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-400/90 dark:text-indigo-300/45">
                    {t(section.ar, section.en)}
                  </div>
                  <ul className="space-y-1">
                    {items.map(({ id, ar, en, Icon }) => (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => navigate(id)}
                          aria-current={activeView === id ? "page" : undefined}
                          className={cn(
                            "flex min-h-[38px] w-full items-center gap-2.5 rounded-xl border-s-2 px-2.5 py-2 text-start text-[12.5px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                            activeView === id
                              ? "border-indigo-500 bg-linear-to-r from-indigo-100 via-violet-100/90 to-fuchsia-100/60 font-semibold text-indigo-950 shadow-sm shadow-indigo-200/60 ring-1 ring-indigo-200/70 dark:border-indigo-300 dark:from-indigo-400/27 dark:via-violet-400/22 dark:to-fuchsia-400/16 dark:text-white dark:shadow-none dark:ring-white/10"
                              : "border-transparent text-slate-600 hover:bg-white/70 hover:text-indigo-950 dark:text-zinc-400 dark:hover:bg-white/6 dark:hover:text-white",
                          )}
                        >
                          <Icon size={17} className={activeView === id ? "text-accent" : ""} />
                          <span className="min-w-0 flex-1 truncate">{t(ar, en)}</span>
                          {id === "inbox" && unread > 0 && (
                            <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-indigo-500 px-1 text-[10px] font-bold text-white">
                              {unread}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
