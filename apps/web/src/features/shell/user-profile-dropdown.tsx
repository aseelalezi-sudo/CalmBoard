"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import {
  IconGlobe,
  IconIntegration,
  IconMoon,
  IconRocket,
  IconSettings,
  IconShield,
  IconSun,
} from "@/components/icons";
import { useAuthOperations } from "@/features/auth/use-auth-operations";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type UserProfileDropdownProps = {
  currentUser: User | null;
  collapsed: boolean;
  setActiveView: (view: string) => void;
  setShowGuide?: (show: boolean) => void;
  setShowTelemetry?: (show: boolean) => void;
  telemetryUiEnabled?: boolean;
  t: (ar: string, en: string) => string;
};

export function UserProfileDropdown({
  currentUser,
  collapsed,
  setActiveView,
  setShowGuide,
  setShowTelemetry,
  telemetryUiEnabled,
  t,
}: UserProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const toggleLocale = useUiStore((state) => state.toggleLocale);
  const { logout } = useAuthOperations();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }, [open]);

  const openProfile = () => {
    setActiveView("profile");
    setOpen(false);
  };

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[12.5px] font-medium text-ink-soft transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("فتح قائمة الحساب", "Open account menu")}
        className={cn(
          "flex h-11 w-full items-center rounded-xl border text-ink-soft transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          collapsed ? "justify-center px-1" : "gap-3 px-2",
          open ? "border-line bg-raised shadow-sm" : "border-transparent",
        )}
      >
        <Avatar src={currentUser?.avatarUrl} name={currentUser?.name} size={30} />
        {!collapsed && (
          <div className="min-w-0 flex-1 text-start">
            <div className="truncate text-[12.5px] font-semibold text-ink">{currentUser?.name}</div>
            <div className="truncate text-[10.5px] text-ink-faint">{currentUser?.email}</div>
          </div>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="animate-pop fixed inset-x-2 top-18 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xl backdrop-blur-xl sm:absolute sm:inset-x-auto sm:bottom-14 sm:end-0 sm:top-auto sm:w-[270px] sm:max-h-none dark:shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        >
          <div className="flex items-center gap-3 border-b border-line p-3">
            <Avatar src={currentUser?.avatarUrl} name={currentUser?.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink">{currentUser?.name}</div>
              <div className="truncate text-[11px] text-ink-faint">{currentUser?.email}</div>
            </div>
          </div>

          <div className="p-1.5">
            <button type="button" role="menuitem" onClick={openProfile} className={itemClass}>
              <IconSettings size={14} />
              <span>{t("إعدادات الحساب", "Account Settings")}</span>
            </button>
            <button type="button" role="menuitem" onClick={openProfile} className={itemClass}>
              <IconShield size={14} />
              <span>{t("الأمان", "Security")}</span>
            </button>
            <button type="button" role="menuitem" onClick={toggleTheme} className={itemClass}>
              {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
              <span className="flex-1">{t("المظهر", "Appearance")}</span>
              <span className="text-[10px] text-ink-faint">
                {theme === "dark" ? t("داكن", "Dark") : t("فاتح", "Light")}
              </span>
            </button>
            <button type="button" role="menuitem" onClick={toggleLocale} className={itemClass}>
              <IconGlobe size={14} />
              <span>{t("تبديل اللغة", "Switch Language")}</span>
            </button>
          </div>

          {(setShowGuide || (telemetryUiEnabled && setShowTelemetry)) && (
            <div className="border-t border-line p-1.5">
              {setShowGuide && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowGuide(true);
                    setOpen(false);
                  }}
                  className={itemClass}
                >
                  <IconRocket size={14} />
                  <span>{t("دليل البدء", "Quick Guide")}</span>
                </button>
              )}
              {telemetryUiEnabled && setShowTelemetry && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowTelemetry(true);
                    setOpen(false);
                  }}
                  className={itemClass}
                >
                  <IconSettings size={14} />
                  <span>{t("القياسات التشغيلية", "Telemetry")}</span>
                </button>
              )}
            </div>
          )}

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout().finally(() => window.location.reload())}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-[12.5px] font-medium text-rose-600 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              <IconIntegration size={14} />
              <span>{t("تسجيل الخروج", "Log out")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
