"use client";

import { create } from "zustand";

export type AppLocale = "ar" | "en";
export type AppTheme = "dark" | "light";

type UiStore = {
  locale: AppLocale;
  theme: AppTheme;
  collapsed: boolean;
  activeView: string;
  hydratePreferences: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setActiveView: (activeView: string) => void;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: AppTheme) => void;
  toggleLocale: () => void;
  toggleTheme: () => void;
};

function applyLocale(locale: AppLocale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
}

function applyTheme(theme: AppTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function storedPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export const useUiStore = create<UiStore>((set, get) => ({
  locale: "ar",
  theme: "light",
  collapsed: false,
  activeView: "table",

  hydratePreferences: () => {
    const locale = storedPreference("calmboard-locale", ["ar", "en"] as const, "ar");
    const theme = storedPreference("calmboard-theme", ["dark", "light"] as const, "light");
    const collapsed =
      storedPreference("calmboard-sidebar", ["expanded", "collapsed"] as const, "expanded") === "collapsed";
    applyLocale(locale);
    applyTheme(theme);
    set({ locale, theme, collapsed });
  },

  setCollapsed: (collapsed) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("calmboard-sidebar", collapsed ? "collapsed" : "expanded");
    }
    set({ collapsed });
  },
  setActiveView: (activeView) => set({ activeView }),

  setLocale: (locale) => {
    if (typeof window !== "undefined") window.localStorage.setItem("calmboard-locale", locale);
    applyLocale(locale);
    set({ locale });
  },

  setTheme: (theme) => {
    if (typeof window !== "undefined") window.localStorage.setItem("calmboard-theme", theme);
    applyTheme(theme);
    set({ theme });
  },

  toggleLocale: () => {
    const locale: AppLocale = get().locale === "ar" ? "en" : "ar";
    get().setLocale(locale);
  },

  toggleTheme: () => {
    const theme: AppTheme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(theme);
  },
}));
