"use client";

import { useState, useRef, useEffect } from "react";
import { EntityIcon } from "@/components/entity-icon";
import { cn } from "@/lib/utils";
import { IconSearch, IconChevron } from "@/components/icons";

export const COMMON_NAMED_ICONS = [
  "folder",
  "briefcase",
  "rocket",
  "code-2",
  "target",
  "clock",
  "bolt",
  "megaphone",
  "smartphone",
  "palette",
  "map",
  "star",
  "shield",
  "database",
  "form",
  "inbox",
  "tag",
  "layers",
  "timeline",
  "trend",
  "users",
  "settings",
  "sparkle",
  "mail",
];

export const POPULAR_EMOJIS = [
  "🏢",
  "🚀",
  "💻",
  "🔥",
  "✨",
  "🌟",
  "💡",
  "🎯",
  "📊",
  "📈",
  "🛠️",
  "⚙️",
  "📁",
  "📂",
  "🎨",
  "📝",
  "🌐",
  "📱",
  "🔒",
  "🔑",
  "📦",
  "📚",
  "💼",
  "🤝",
];

export function IconPicker({
  name = "icon",
  defaultValue = "folder",
  value: controlledValue,
  onChange,
  fallback = "project",
  compact = false,
  label,
  t,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (val: string) => void;
  fallback?: "project" | "workspace" | "document";
  compact?: boolean;
  label?: string;
  t?: (ar: string, en: string) => string;
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"icons" | "emojis">("icons");
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedValue = controlledValue !== undefined ? controlledValue : internalValue;

  const handleSelect = (val: string) => {
    if (controlledValue === undefined) {
      setInternalValue(val);
    }
    onChange?.(val);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const filteredIcons = COMMON_NAMED_ICONS.filter((ic) => ic.toLowerCase().includes(search.toLowerCase()));

  const tr = t || ((ar: string, en: string) => en);

  return (
    <div className="relative" ref={containerRef}>
      {name && <input type="hidden" name={name} value={selectedValue} />}
      {compact ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label || tr("اختر أيقونة", "Choose an icon")}
          className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-surface text-ink shadow-sm transition hover:bg-raised focus-ring"
        >
          <EntityIcon value={selectedValue} fallback={fallback} size={16} />
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label || tr("اختر أيقونة", "Choose an icon")}
          className="flex h-10 w-full items-center justify-between gap-2.5 rounded-xl border border-line bg-surface px-3 transition-colors hover:bg-raised focus-ring"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-raised text-ink border border-line">
              <EntityIcon value={selectedValue} fallback={fallback} size={16} />
            </div>
            <span className="truncate text-[13px] font-medium text-ink">
              {selectedValue || tr("اختر أيقونة", "Choose an icon")}
            </span>
          </div>
          <IconChevron
            size={14}
            className={cn("text-ink-faint transition-transform", open ? "-rotate-90" : "rotate-90")}
          />
        </button>
      )}

      {open && (
        <div className="absolute top-12 start-0 z-50 w-72 rounded-2xl border border-line bg-surface p-3 shadow-2xl backdrop-blur-xl ring-1 ring-line animate-pop">
          {/* Search bar */}
          <div className="flex items-center gap-2 rounded-xl border border-line bg-raised/60 px-2.5 py-1 text-ink focus-within:border-accent/50 mb-2.5">
            <IconSearch size={13} className="shrink-0 text-ink-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr("ابحث عن أيقونة…", "Search icons…")}
              className="h-6 w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>

          {/* Tab selector */}
          <div className="flex gap-1 border-b border-line pb-2 mb-2">
            <button
              type="button"
              onClick={() => setTab("icons")}
              className={cn(
                "flex-1 py-1 text-center text-[11.5px] font-semibold rounded-lg transition",
                tab === "icons"
                  ? "bg-accent/15 text-accent font-bold"
                  : "text-ink-faint hover:text-ink hover:bg-raised",
              )}
            >
              {tr("الأيقونات", "Icons")}
            </button>
            <button
              type="button"
              onClick={() => setTab("emojis")}
              className={cn(
                "flex-1 py-1 text-center text-[11.5px] font-semibold rounded-lg transition",
                tab === "emojis"
                  ? "bg-accent/15 text-accent font-bold"
                  : "text-ink-faint hover:text-ink hover:bg-raised",
              )}
            >
              {tr("إيموجي", "Emojis")}
            </button>
          </div>

          {/* Icon list */}
          <div className="max-h-48 overflow-y-auto p-0.5 scrollbar-thin">
            {tab === "icons" ? (
              <div className="grid grid-cols-6 gap-1.5">
                {filteredIcons.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    title={ic}
                    onClick={() => handleSelect(ic)}
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-xl border border-transparent text-ink transition hover:border-accent/40 hover:bg-raised active:scale-95",
                      selectedValue === ic && "border-accent bg-accent/15 text-accent font-bold shadow-xs",
                    )}
                  >
                    <EntityIcon value={ic} fallback={fallback} size={16} />
                  </button>
                ))}
                {filteredIcons.length === 0 && (
                  <div className="col-span-6 py-4 text-center text-[11px] text-ink-faint">
                    {tr("لا توجد نتائج مطابقة", "No matching icons")}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-6 gap-1.5">
                {POPULAR_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleSelect(emoji)}
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-xl text-[16px] transition hover:bg-raised active:scale-95",
                      selectedValue === emoji && "bg-accent/15 font-bold shadow-xs",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
