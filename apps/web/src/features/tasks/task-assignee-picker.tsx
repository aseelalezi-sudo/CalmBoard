"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Member, Task, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import { IconCheck, IconPlus, IconSearch, IconStar, IconUsers, IconX } from "@/components/icons";
import {
  buildAddAssigneeMutation,
  buildClearAllAssigneesMutation,
  buildRemoveAssigneeMutation,
  buildSetLeadMutation,
  getTaskAssigneeIds,
  getWorkspaceCandidateUsers,
  type AssignmentMutationPayload,
} from "./assignment-domain";

export type TaskAssigneePickerProps = {
  task?: Partial<Task> | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
  users?: User[];
  members?: Member[];
  canEdit?: boolean;
  onSave?: (result: AssignmentMutationPayload) => Promise<boolean> | boolean | void;
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
  const uniqueId = useId();
  const listId = `assignee-candidates-list-${uniqueId.replace(/:/g, "")}`;
  const searchInputId = `assignee-search-input-${uniqueId.replace(/:/g, "")}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const candidateButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  // Controlled/local assignment draft
  const [draftLeadId, setDraftLeadId] = useState<string | null>(() => {
    if (initialAssigneeId !== undefined) return initialAssigneeId;
    return task?.assigneeId ?? null;
  });

  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>(() => {
    if (initialAssigneeIds !== undefined) return initialAssigneeIds;
    return getTaskAssigneeIds(task);
  });

  const taskLeadId = task?.assigneeId ?? null;
  const taskAssigneeIds = useMemo(() => getTaskAssigneeIds(task), [task]);

  // Sync draft state whenever task props change from canonical server responses
  useEffect(() => {
    if (task) {
      setDraftLeadId(taskLeadId);
      setDraftAssigneeIds(taskAssigneeIds);
    }
  }, [task, taskLeadId, taskAssigneeIds]);

  const [searchQuery, setSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Get active candidate users strictly scoped to active workspace members
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

  const handleCloseWithFocusRestore = useCallback(() => {
    onClose();
    if (triggerElementRef.current && document.body.contains(triggerElementRef.current)) {
      setTimeout(() => {
        triggerElementRef.current?.focus();
      }, 0);
    }
  }, [onClose]);

  // Sync back to callers
  const applyMutation = async (mutation: AssignmentMutationPayload) => {
    const prevLead = draftLeadId;
    const prevIds = draftAssigneeIds;

    // Optimistic local state update
    const optimisticLead = mutation.assigneeId !== undefined ? mutation.assigneeId : (mutation.assigneeIds[0] ?? null);
    const newIds = mutation.assigneeIds;

    setDraftLeadId(optimisticLead);
    setDraftAssigneeIds(newIds);

    // Notify draft consumer (e.g. NewTaskModal) with deterministic local lead
    onChange?.({
      assigneeId: optimisticLead,
      assigneeIds: newIds,
    });

    if (onSave) {
      setIsSubmitting(true);
      try {
        // Send mutation payload EXACTLY as produced by the domain builder (preserving undefined assigneeId)
        const saveResult = await onSave(mutation);
        if (saveResult === false) {
          // Restore draft state on failure
          setDraftLeadId(prevLead);
          setDraftAssigneeIds(prevIds);
        }
      } catch {
        // Restore draft state on error
        setDraftLeadId(prevLead);
        setDraftAssigneeIds(prevIds);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // Keyboard and click-outside listeners with focus capture/restoration
  useEffect(() => {
    if (typeof document !== "undefined") {
      triggerElementRef.current = document.activeElement as HTMLElement | null;
    }
    searchInputRef.current?.focus();

    const handlePointerDown = (event: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleCloseWithFocusRestore();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleCloseWithFocusRestore();
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
  }, [handleCloseWithFocusRestore]);

  // If filtering removes the currently focused candidate, move focus safely
  useEffect(() => {
    if (typeof document === "undefined") return;
    const activeEl = document.activeElement;
    if (listRef.current && activeEl && listRef.current.contains(activeEl)) {
      const isStillValid = candidateButtonRefs.current.some(
        (btn) => btn && (btn === activeEl || btn.parentElement?.contains(activeEl)),
      );
      if (!isStillValid) {
        if (candidateButtonRefs.current[0]) {
          candidateButtonRefs.current[0]?.focus();
        } else {
          searchInputRef.current?.focus();
        }
      }
    }
  }, [filteredCandidates]);

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

  // Search input keyboard handling
  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (filteredCandidates.length > 0) {
        e.preventDefault();
        candidateButtonRefs.current[0]?.focus();
        candidateButtonRefs.current[0]?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleCloseWithFocusRestore();
    }
  };

  // Candidate primary toggle button keyboard handling
  const handleCandidateKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = idx < filteredCandidates.length - 1 ? idx + 1 : 0;
      candidateButtonRefs.current[nextIdx]?.focus();
      candidateButtonRefs.current[nextIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx === 0) {
        searchInputRef.current?.focus();
      } else {
        const prevIdx = idx - 1;
        candidateButtonRefs.current[prevIdx]?.focus();
        candidateButtonRefs.current[prevIdx]?.scrollIntoView({ block: "nearest" });
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleCloseWithFocusRestore();
    }
  };

  // Candidate Make Lead button keyboard handling
  const handleMakeLeadKeyDown = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = idx < filteredCandidates.length - 1 ? idx + 1 : 0;
      candidateButtonRefs.current[nextIdx]?.focus();
      candidateButtonRefs.current[nextIdx]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      candidateButtonRefs.current[idx]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleCloseWithFocusRestore();
    }
  };

  const isRtl = locale === "ar";

  const pickerContent = (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal={position === "modal" ? "true" : undefined}
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
          onClick={handleCloseWithFocusRestore}
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
            id={searchInputId}
            ref={searchInputRef}
            type="search"
            aria-controls={listId}
            aria-label={t("البحث في الأعضاء", "Search members")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("البحث بالاسم أو البريد…", "Search members…")}
            className="h-8 w-full rounded-xl border border-line bg-raised/50 ps-8 pe-3 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:bg-surface focus:outline-none transition"
          />
        </div>
      </div>

      {/* Member Semantic List */}
      <ul
        id={listId}
        ref={listRef}
        role="list"
        aria-label={t("قائمة المرشحين", "Candidate assignees")}
        className="flex-1 overflow-y-auto p-2 space-y-1 min-h-[160px] max-h-[240px] list-none focus:outline-none"
      >
        {filteredCandidates.length === 0 ? (
          <li className="py-6 text-center text-[12px] text-ink-faint list-none">
            {t("لم يتم العثور على أعضاء مطابقين", "No members found")}
          </li>
        ) : (
          filteredCandidates.map((user, idx) => {
            const isAssigned = draftAssigneeIds.includes(user.id);
            const isLead = draftLeadId === user.id || (!draftLeadId && draftAssigneeIds[0] === user.id);
            const isContributor = isAssigned && !isLead;

            const memberLabel = `${user.name}${
              isLead ? ` (${t("مسؤول رئيسي", "Lead")})` : isContributor ? ` (${t("مشارك", "Contributor")})` : ""
            } - ${isAssigned ? t("معين", "Assigned") : t("غير معين", "Unassigned")}`;

            return (
              <li
                key={user.id}
                role="listitem"
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 transition-colors text-start",
                  isAssigned && "bg-accent/5 dark:bg-accent/10",
                )}
              >
                {/* Main Member Toggle Button */}
                <button
                  type="button"
                  ref={(el) => {
                    candidateButtonRefs.current[idx] = el;
                  }}
                  disabled={!canEdit || isSubmitting}
                  aria-pressed={isAssigned}
                  aria-label={memberLabel}
                  onClick={() => {
                    if (isAssigned) {
                      void applyMutation(buildRemoveAssigneeMutation(draftTaskObj, user.id));
                    } else {
                      void applyMutation(buildAddAssigneeMutation(draftTaskObj, user.id));
                    }
                  }}
                  onKeyDown={(e) => handleCandidateKeyDown(e, idx)}
                  className="flex flex-1 min-w-0 items-center gap-2.5 rounded-lg p-1 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <div className="relative shrink-0">
                    <Avatar src={user.avatarUrl} name={user.name} size={24} />
                    {isLead && (
                      <span
                        aria-hidden="true"
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
                          <span aria-hidden="true">★</span> <span>{t("رئيسي", "Lead")}</span>
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
                    onKeyDown={(e) => handleMakeLeadKeyDown(e, idx)}
                    className="shrink-0 rounded-lg p-1 text-ink-faint hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-500/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <IconStar size={13} aria-hidden="true" />
                    <span className="sr-only">{t("تعيين كمسؤول رئيسي", "Make Lead")}</span>
                  </button>
                )}
              </li>
            );
          })
        )}
      </ul>

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
          onClick={handleCloseWithFocusRestore}
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
