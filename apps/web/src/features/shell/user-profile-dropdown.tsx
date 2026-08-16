"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import {
  IconIntegration,
  IconMoon,
  IconRocket,
  IconSettings,
  IconShield,
  IconSun,
  IconGauge,
} from "@/components/icons";
import { useAuthOperations } from "@/features/auth/use-auth-operations";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type UserProfileDropdownProps = {
  currentUser: User | null;
  collapsed?: boolean;
  setActiveView: (view: string) => void;
  setShowGuide?: (show: boolean) => void;
  setShowTelemetry?: (show: boolean) => void;
  telemetryUiEnabled?: boolean;
  t: (ar: string, en: string) => string;
};

export function UserProfileDropdown({
  currentUser,
  collapsed = false,
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
  const setTheme = useUiStore((state) => state.setTheme);
  const locale = useUiStore((state) => state.locale);
  const setLocale = useUiStore((state) => state.setLocale);
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

  return (
    <div className="relative shrink-0" ref={containerRef}>
      {/* Avatar Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("فتح قائمة الحساب", "Open account menu")}
        title={currentUser?.name || t("الحساب", "Account")}
        className={cn(
          "group relative flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl border-2 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-95",
          open
            ? "border-accent ring-3 ring-accent/25 shadow-md bg-raised"
            : "border-line/90 bg-surface shadow-2xs hover:border-accent/60 hover:shadow-xs",
        )}
      >
        <Avatar src={currentUser?.avatarUrl} name={currentUser?.name} size={30} />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="animate-pop fixed inset-x-2 top-18 z-50 flex max-h-[calc(100dvh-5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-surface/98 shadow-2xl backdrop-blur-2xl ring-1 ring-line/50 sm:absolute sm:inset-x-auto sm:end-0 sm:top-12 sm:w-[310px] sm:max-h-none dark:shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
        >
          {/* Header User Card */}
          <div className="border-b border-line bg-linear-to-b from-raised/60 to-raised/20 p-4">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <Avatar src={currentUser?.avatarUrl} name={currentUser?.name} size={42} />
                <span className="live-dot absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-surface" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-ink">
                  {currentUser?.name || t("المستخدم", "User")}
                </div>
                <div className="truncate text-[11.5px] text-ink-soft">{currentUser?.email}</div>
              </div>
            </div>
          </div>

          {/* Quick Preferences: Theme & Language Segmented Switchers */}
          <div className="space-y-2.5 border-b border-line p-3 bg-surface">
            {/* Theme Switcher */}
            <div>
              <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-bold text-indigo-500 dark:text-indigo-400">
                <span>{t("المظهر", "Theme")}</span>
                <span className="text-[10px] font-medium text-ink-faint">
                  {theme === "dark" ? t("الوضع الداكن", "Dark Mode") : t("الوضع الفاتح", "Light Mode")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-raised/70 p-1">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-[0.98]",
                    theme === "light"
                      ? "border border-line bg-surface text-ink shadow-xs"
                      : "text-ink-soft hover:text-ink hover:bg-raised/50",
                  )}
                >
                  <IconSun size={14} className={theme === "light" ? "text-amber-500" : "text-ink-faint"} />
                  <span>{t("فاتح", "Light")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-[0.98]",
                    theme === "dark"
                      ? "border border-line bg-surface text-ink shadow-xs"
                      : "text-ink-soft hover:text-ink hover:bg-raised/50",
                  )}
                >
                  <IconMoon size={14} className={theme === "dark" ? "text-indigo-400" : "text-ink-faint"} />
                  <span>{t("داكن", "Dark")}</span>
                </button>
              </div>
            </div>

            {/* Language Switcher */}
            <div>
              <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-bold text-indigo-500 dark:text-indigo-400">
                <span>{t("اللغة", "Language")}</span>
                <span className="text-[10px] font-medium text-ink-faint">
                  {locale === "ar" ? "العربية" : "English"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-raised/70 p-1">
                <button
                  type="button"
                  onClick={() => setLocale("ar")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-[0.98]",
                    locale === "ar"
                      ? "border border-line bg-surface text-accent shadow-xs font-bold"
                      : "text-ink-soft hover:text-ink hover:bg-raised/50",
                  )}
                >
                  <span className="text-[13px]">🇸🇦</span>
                  <span>العربية</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLocale("en")}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-[0.98]",
                    locale === "en"
                      ? "border border-line bg-surface text-accent shadow-xs font-bold"
                      : "text-ink-soft hover:text-ink hover:bg-raised/50",
                  )}
                >
                  <span className="text-[13px]">🇬🇧</span>
                  <span>English</span>
                </button>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <div className="space-y-0.5 p-2">
            <button
              type="button"
              role="menuitem"
              onClick={openProfile}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[12.5px] font-medium text-ink-soft transition-all duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line/60 bg-raised/60 text-ink-soft transition-colors group-hover:border-accent/40 group-hover:bg-accent/10 group-hover:text-accent shadow-2xs">
                <IconSettings size={14} />
              </span>
              <span className="flex-1 truncate">{t("إعدادات الحساب", "Account Settings")}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={openProfile}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[12.5px] font-medium text-ink-soft transition-all duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line/60 bg-raised/60 text-ink-soft transition-colors group-hover:border-accent/40 group-hover:bg-accent/10 group-hover:text-accent shadow-2xs">
                <IconShield size={14} />
              </span>
              <span className="flex-1 truncate">{t("الأمان وجلسات الدخول", "Security & Sessions")}</span>
            </button>

            {setShowGuide && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowGuide(true);
                  setOpen(false);
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[12.5px] font-medium text-ink-soft transition-all duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line/60 bg-raised/60 text-ink-soft transition-colors group-hover:border-accent/40 group-hover:bg-accent/10 group-hover:text-accent shadow-2xs">
                  <IconRocket size={14} />
                </span>
                <span className="flex-1 truncate">{t("دليل البدء السريع", "Quick Guide")}</span>
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
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[12.5px] font-medium text-ink-soft transition-all duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.99]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line/60 bg-raised/60 text-ink-soft transition-colors group-hover:border-accent/40 group-hover:bg-accent/10 group-hover:text-accent shadow-2xs">
                  <IconGauge size={14} />
                </span>
                <span className="flex-1 truncate">{t("القياسات التشغيلية", "Telemetry & Metrics")}</span>
              </button>
            )}
          </div>

          {/* Logout Section */}
          <div className="border-t border-line p-2 bg-rose-500/5">
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout().finally(() => window.location.reload())}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-[12.5px] font-semibold text-rose-600 transition-all duration-150 hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/40 dark:text-rose-400 active:scale-[0.99]"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-600 transition-colors group-hover:border-rose-500/40 group-hover:bg-rose-500/20 dark:text-rose-400 shadow-2xs">
                <IconIntegration size={14} />
              </span>
              <span className="flex-1 truncate">{t("تسجيل الخروج", "Log out")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
