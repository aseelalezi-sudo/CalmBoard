"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Member, Task, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, Badge, Btn, Kbd } from "@/components/ui";
import { IconCheck, IconPlus, IconSearch, IconStar, IconUsers, IconX } from "@/components/icons";
import {
  buildAddAssigneeMutation,
  buildClearAllAssigneesMutation,
  buildRemoveAssigneeMutation,
  buildSetLeadMutation,
  getTaskAssigneeIds,
  getWorkspaceCandidateUsers,
  isTaskContributor,
  isTaskLead,
} from "./assignment-domain";

export type TaskAssigneePickerProps = {
  task?: Partial<Task> | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
  users?: User[];
  members?: Member[];
  canEdit?: boolean;
  onSave?: (result: { assigneeId: string | null; assigneeIds: string[] }) => void | Promise<void | boolean>;
  onChange?: (result: { assigneeId: string | null; assigneeIds: string[] }) => void;
  onClose: () => void;
  anchorRect?: { top: number; left: number; width: number; height: number; bottom: number; right: number } | null;
  position?: "popover" | "modal";
  t?: (ar: string, en: string) => string;
  locale?: "ar" | "en";
};

export function TaskAssigneePicker({
  task,
  assigneeId: initialAssigneeId,
  assigneeIds: initialAssigneeIds,
  users,
  members,
  canEdit = true,
  onSave,
  onChange,
  onClose,
  anchorRect,
  position = "popover",
  t = (ar, en) => en,
  locale = "en",
}: TaskAssigneePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Controlled/local assignment draft
  const [draftLeadId, setDraftLeadId] = useState<string | null>(() => {
    if (initialAssigneeId !== undefined) return initialAssigneeId;
    return task?.assigneeId ?? null;
  });

  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>(() => {
    if (initialAssigneeIds !== undefined) return initialAssigneeIds;
    return getTaskAssigneeIds(task);
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get active candidate users scoped to workspace
  const candidateUsers = useMemo(() => getWorkspaceCandidateUsers(members, users), [members, users]);

  // Filter candidates by search query
  const filteredCandidates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidateUsers;
    return candidateUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || (u.email && u.email.toLowerCase().includes(q)),
    );
  }, [candidateUsers, searchQuery]);

  // Current draft representation as a task object for pure mutation helpers
  const draftTaskObj = useMemo(
    () => ({
      assigneeId: draftLeadId,
      assigneeIds: draftAssigneeIds,
    }),
    [draftLeadId, draftAssigneeIds],
  );

  // Sync back to callers
  const applyMutation = async (mutation: { assigneeId?: string | null; assigneeIds: string[] }) => {
    const newLead = mutation.assigneeId !== undefined ? mutation.assigneeId : (mutation.assigneeIds[0] ?? null);
    const newIds = mutation.assigneeIds;

    setDraftLeadId(newLead);
    setDraftAssigneeIds(newIds);

    onChange?.({
      assigneeId: newLead,
      assigneeIds: newIds,
    });

    if (onSave) {
      setIsSubmitting(true);
      try {
        await onSave({
          assigneeId: newLead,
          assigneeIds: newIds,
        });
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Keyboard and click-outside listeners
  useEffect(() => {
    searchInputRef.current?.focus();

    const handlePointerDown = (event: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Popover positioning calculation
  const popoverStyle = useMemo(() => {
    if (position === "modal" || !anchorRect || typeof window === "undefined") {
      return {};
    }

    const popoverWidth = 320;
    const popoverHeight = 380;
    const padding = 12;

    let top = anchorRect.bottom + 6;
    let left = anchorRect.left;

    // Viewport collision checks
    if (top + popoverHeight > window.innerHeight - padding) {
      top = Math.max(padding, anchorRect.top - popoverHeight - 6);
    }

    if (locale === "ar") {
      left = anchorRect.right - popoverWidth;
      if (left < padding) {
        left = padding;
      }
    } else {
      if (left + popoverWidth > window.innerWidth - padding) {
        left = Math.max(padding, window.innerWidth - popoverWidth - padding);
      }
    }

    return {
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      position: "fixed" as const,
      zIndex: 9999,
    };
  }, [anchorRect, position, locale]);

  const handleListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (filteredCandidates.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev < filteredCandidates.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev > 0 ? prev - 1 : filteredCandidates.length - 1));
    } else if (e.key === "Enter" && focusedIndex >= 0 && focusedIndex < filteredCandidates.length) {
      e.preventDefault();
      const targetUser = filteredCandidates[focusedIndex];
      if (canEdit && !isSubmitting) {
        const isAssigned = draftAssigneeIds.includes(targetUser.id);
        if (isAssigned) {
          void applyMutation(buildRemoveAssigneeMutation(draftTaskObj, targetUser.id));
        } else {
          void applyMutation(buildAddAssigneeMutation(draftTaskObj, targetUser.id));
        }
      }
    }
  };

  const isRtl = locale === "ar";

  const pickerContent = (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("تعيين المسؤولين والمشاركين", "Assign Lead and Contributors")}
      dir={isRtl ? "rtl" : "ltr"}
      style={popoverStyle}
      className={cn(
        "flex flex-col rounded-2xl border border-line bg-surface/98 backdrop-blur-md shadow-2xl transition-all animate-fade",
        position === "popover" && "w-[320px] max-h-[420px] text-ink",
        position === "modal" &&
          "fixed inset-x-4 top-1/2 -translate-y-1/2 mx-auto max-w-sm max-h-[85vh] z-[9999] shadow-2xl ring-1 ring-black/10",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-3.5 py-3">
        <div className="flex items-center gap-2">
          <IconUsers size={15} className="text-accent" />
          <span className="text-[13px] font-bold text-ink">{t("المسؤولون والمشاركون", "People & Assignment")}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("إغلاق", "Close")}
          className="grid h-6 w-6 place-items-center rounded-lg text-ink-faint hover:bg-raised hover:text-ink transition"
        >
          <IconX size={14} />
        </button>
      </div>

      {/* Permission Warning if read-only */}
      {!canEdit && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-3.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium">
          {t(
            "وضع العرض فقط. ليس لديك صلاحية تعديل المسؤولين.",
            "View only. You don't have permission to edit assignees.",
          )}
        </div>
      )}

      {/* Search Input */}
      <div className="p-3 border-b border-line/60">
        <div className="relative flex items-center">
          <IconSearch size={13} className="absolute start-2.5 text-ink-faint pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            role="searchbox"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setFocusedIndex(0);
            }}
            onKeyDown={handleListKeyDown}
            placeholder={t("البحث بالاسم أو البريد…", "Search members…")}
            className="h-8 w-full rounded-xl border border-line bg-raised/50 ps-8 pe-3 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none transition"
          />
        </div>
      </div>

      {/* Member List */}
      <div
        ref={listRef}
        role="list"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        className="flex-1 overflow-y-auto p-2 space-y-1 focus:outline-none min-h-[160px] max-h-[240px]"
      >
        {filteredCandidates.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-ink-faint">
            {t("لم يتم العثور على أعضاء مطابقين", "No members found")}
          </div>
        ) : (
          filteredCandidates.map((user, idx) => {
            const isAssigned = draftAssigneeIds.includes(user.id);
            const isLead = draftLeadId === user.id || (!draftLeadId && draftAssigneeIds[0] === user.id);
            const isContributor = isAssigned && !isLead;
            const isFocused = focusedIndex === idx;

            return (
              <div
                key={user.id}
                role="listitem"
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 transition-colors text-start",
                  isFocused ? "bg-raised" : "hover:bg-raised/70",
                  isAssigned && "bg-accent/5 dark:bg-accent/10",
                )}
              >
                {/* Main Member Toggle Button */}
                <button
                  type="button"
                  disabled={!canEdit || isSubmitting}
                  aria-pressed={isAssigned}
                  onClick={() => {
                    if (isAssigned) {
                      void applyMutation(buildRemoveAssigneeMutation(draftTaskObj, user.id));
                    } else {
                      void applyMutation(buildAddAssigneeMutation(draftTaskObj, user.id));
                    }
                  }}
                  className="flex flex-1 min-w-0 items-center gap-2.5 focus:outline-none"
                >
                  <div className="relative shrink-0">
                    <Avatar src={user.avatarUrl} name={user.name} size={24} />
                    {isLead && (
                      <span
                        aria-label={t("مسؤول رئيسي", "Lead")}
                        title={t("مسؤول رئيسي", "Lead")}
                        className="absolute -bottom-0.5 -end-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-amber-500 text-white text-[8px] font-black ring-1 ring-surface shadow-xs pointer-events-none"
                      >
                        ★
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-semibold text-ink">{user.name}</span>
                      {isLead && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 px-1 py-0.2 text-[9px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                          ★ {t("رئيسي", "Lead")}
                        </span>
                      )}
                      {isContributor && (
                        <span className="inline-flex items-center rounded-md bg-slate-500/10 border border-slate-500/20 px-1 py-0.2 text-[9px] font-medium text-ink-soft shrink-0">
                          {t("مشارك", "Contributor")}
                        </span>
                      )}
                    </div>
                    {user.email && <div className="truncate text-[10.5px] text-ink-faint">{user.email}</div>}
                  </div>

                  <div className="shrink-0">
                    {isAssigned ? (
                      <span className="grid h-4 w-4 place-items-center rounded-md bg-accent text-white shadow-xs">
                        <IconCheck size={10} />
                      </span>
                    ) : (
                      <span className="grid h-4 w-4 place-items-center rounded-md border border-line opacity-0 group-hover:opacity-100 text-ink-faint">
                        <IconPlus size={9} />
                      </span>
                    )}
                  </div>
                </button>

                {/* Secondary Action: Make Lead (only shown when assigned as Contributor and editable) */}
                {canEdit && isContributor && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    title={t("تعيين كمسؤول رئيسي للمهمة", "Make Lead")}
                    aria-label={`${t("تعيين كمسؤول رئيسي", "Make Lead")} - ${user.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void applyMutation(buildSetLeadMutation(draftTaskObj, user.id));
                    }}
                    className="shrink-0 rounded-lg p-1 text-ink-faint hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 transition"
                  >
                    <IconStar size={13} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer / Actions */}
      <div className="flex items-center justify-between border-t border-line p-2.5 bg-raised/30">
        <button
          type="button"
          disabled={!canEdit || isSubmitting || draftAssigneeIds.length === 0}
          onClick={() => void applyMutation(buildClearAllAssigneesMutation())}
          className="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline disabled:opacity-40 disabled:no-underline transition px-1.5 py-0.5"
        >
          {t("إلغاء التعيين للكل", "Clear all")}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-accent px-3 py-1 text-[11.5px] font-bold text-white shadow-xs hover:brightness-105 active:scale-95 transition"
        >
          {t("تم", "Done")}
        </button>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    position === "modal" ? (
      <div className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
        {pickerContent}
      </div>
    ) : (
      pickerContent
    ),
    document.body,
  );
}
