"use client";

import type { MouseEvent } from "react";
import type { Member, Task, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import { resolveTaskPeople } from "./assignment-domain";
import { IconUsers } from "@/components/icons";

export type TaskAssigneeStackProps = {
  task?: Partial<Task> | null;
  assigneeId?: string | null;
  assigneeIds?: string[];
  assignees?: User[];
  users?: User[];
  members?: Member[];
  size?: number;
  maxVisible?: number;
  showLabel?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  className?: string;
  t?: (ar: string, en: string) => string;
  locale?: "ar" | "en";
};

export function TaskAssigneeStack({
  task,
  assigneeId,
  assigneeIds,
  assignees,
  users,
  members,
  size = 22,
  maxVisible = 3,
  showLabel = false,
  interactive = false,
  disabled = false,
  onClick,
  className,
  t = (ar, en) => en,
  locale = "en",
}: TaskAssigneeStackProps) {
  const mergedTask: Partial<Task> = {
    ...task,
    assigneeId: assigneeId !== undefined ? assigneeId : task?.assigneeId,
    assigneeIds: assigneeIds !== undefined ? assigneeIds : task?.assigneeIds,
    assignees: assignees !== undefined ? assignees : task?.assignees,
  };

  const people = resolveTaskPeople(mergedTask, users, members);
  const unassignedLabel = t("غير محدد", "Unassigned");

  if (people.length === 0) {
    if (interactive) {
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          aria-label={t("تعيين مسؤولين ومشاركين", "Assign people")}
          className={cn(
            "group/stack inline-flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-[11px] font-medium text-ink-faint transition-colors hover:bg-raised hover:text-ink max-w-full disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
        >
          <span
            className="grid place-items-center rounded-full border border-dashed border-line bg-raised/40 text-ink-faint group-hover/stack:border-accent/40 group-hover/stack:text-accent shrink-0"
            style={{ width: size, height: size }}
          >
            <IconUsers size={Math.max(10, Math.floor(size * 0.55))} />
          </span>
          <span className="truncate">{unassignedLabel}</span>
        </button>
      );
    }

    return (
      <div
        className={cn("inline-flex items-center gap-1.5 text-[11px] text-ink-faint italic max-w-full", className)}
        title={unassignedLabel}
      >
        <span
          className="grid place-items-center rounded-full border border-dashed border-line/70 bg-surface text-ink-faint/80 shrink-0"
          style={{ width: size, height: size }}
        >
          <IconUsers size={Math.max(10, Math.floor(size * 0.55))} />
        </span>
        <span className="truncate">{unassignedLabel}</span>
      </div>
    );
  }

  const visiblePeople = people.slice(0, maxVisible);
  const overflowCount = people.length - visiblePeople.length;

  const stackSummary = people
    .map((p) => `${p.user.name} (${p.isLead ? t("مسؤول رئيسي", "Lead") : t("مشارك", "Contributor")})`)
    .join(", ");

  const leadLabel = t("مسؤول رئيسي", "Lead");
  const contributorLabel = t("مشارك", "Contributor");

  const content = (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 max-w-full",
        interactive &&
          "group/stack rounded-lg px-1.5 py-0.5 transition-colors hover:bg-raised cursor-pointer disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      title={stackSummary}
      aria-label={stackSummary}
    >
      <div className="flex items-center -space-x-1.5 rtl:space-x-reverse shrink-0">
        {visiblePeople.map((person) => {
          const roleText = person.isLead ? leadLabel : contributorLabel;
          const userTitle = `${person.user.name} (${roleText})`;

          return (
            <div
              key={person.user.id}
              className="relative inline-flex shrink-0 rounded-full ring-2 ring-surface transition-transform hover:z-10 hover:scale-105"
              title={userTitle}
            >
              <Avatar src={person.user.avatarUrl} name={person.user.name} size={size} />
              {person.isLead && (
                <span
                  aria-label={leadLabel}
                  title={`${person.user.name} - ${leadLabel}`}
                  className="absolute -bottom-0.5 -end-0.5 grid h-3 w-3 place-items-center rounded-full bg-amber-500 text-white text-[7px] font-black ring-1 ring-surface shadow-xs pointer-events-none"
                >
                  ★
                </span>
              )}
            </div>
          );
        })}

        {overflowCount > 0 && (
          <div
            className="grid place-items-center rounded-full border border-line bg-raised font-bold text-ink-soft ring-2 ring-surface shrink-0 select-none"
            style={{
              width: size,
              height: size,
              fontSize: Math.max(9, Math.floor(size * 0.42)),
            }}
            title={people
              .slice(maxVisible)
              .map((p) => p.user.name)
              .join(", ")}
          >
            +{overflowCount}
          </div>
        )}
      </div>

      {showLabel && people.length === 1 && (
        <span className="truncate text-[11.5px] font-medium text-ink-soft group-hover/stack:text-ink">
          {people[0].user.name}
        </span>
      )}
    </div>
  );

  if (interactive) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="text-start appearance-none bg-transparent p-0 border-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded-lg"
        aria-label={stackSummary}
      >
        {content}
      </button>
    );
  }

  return content;
}
