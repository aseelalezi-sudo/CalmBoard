"use client";

import { useState } from "react";
import type { Doc, Project, Task } from "@/lib/types";
import { STATUS_CONFIG } from "@/lib/types";
import { Avatar, Badge, Kbd } from "@/components/ui";
import {
  IconCode,
  IconComment,
  IconDash,
  IconDoc,
  IconFolder,
  IconGlobe,
  IconPaperclip,
  IconPlus,
  IconSearch,
  IconSparkle,
  IconUsers,
} from "@/components/icons";
import type { SearchScope } from "./api";
import { useCommandSearch } from "./use-command-search";

const resultButtonClass =
  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition hover:bg-slate-100 dark:hover:bg-white/[0.05]";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">
      {children}
    </div>
  );
}

export function CommandPalette({
  open,
  onClose,
  query,
  setQuery,
  scope,
  projects,
  locale,
  t,
  openTask,
  openTaskById,
  switchProject,
  openDoc,
  filterAssignee,
  toggleLocale,
  newTask,
  goDashboard,
  openAI,
}: {
  open: boolean;
  onClose: () => void;
  query: string;
  setQuery: (query: string) => void;
  scope?: SearchScope;
  projects: Project[];
  locale: "ar" | "en";
  t: (arabic: string, english: string) => string;
  openTask: (task: Task) => void;
  openTaskById: (task: Pick<Task, "id" | "organizationId" | "workspaceId">) => void;
  switchProject: (project: Project) => void;
  openDoc: (document: Doc) => void;
  filterAssignee: (userId: string) => void;
  toggleLocale: () => void;
  newTask: () => void;
  goDashboard: () => void;
  openAI: () => void;
}) {
  const [retryKey, setRetryKey] = useState(0);
  const { normalizedQuery, results, loading, error } = useCommandSearch({ open, query, scope, retryKey });
  if (!open) return null;

  const hasResults = Object.values(results).some((items) => items.length > 0);
  const actions = [
    { label: t("مهمة جديدة", "New task"), Icon: IconPlus, action: newTask },
    { label: t("لوحة التحكم", "Dashboard"), Icon: IconDash, action: goDashboard },
    {
      label: t("وثائق API", "API Reference"),
      Icon: IconCode,
      action: () => {
        window.location.href = "/api-reference";
      },
    },
    { label: t("تبديل اللغة", "Toggle language"), Icon: IconGlobe, action: toggleLocale },
    { label: t("المساعد الذكي", "AI assistant"), Icon: IconSparkle, action: openAI },
  ];

  return (
    <div className="fixed inset-0 z-70 flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-slate-900/45 backdrop-blur-md dark:bg-zinc-950/70 animate-fade"
        onClick={onClose}
      />
      <div className="theme-adaptive-panel animate-pop relative w-full max-w-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-[0_24px_80px_rgba(15,23,42,0.22),0_0_60px_rgba(99,102,241,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/95 dark:shadow-[0_24px_80px_rgba(0,0,0,0.7),0_0_60px_rgba(99,102,241,0.1)]">
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 px-5 dark:border-white/[0.07]">
          <IconSearch size={16} className="text-slate-500 dark:text-zinc-500" />
          <input
            id="search-query"
            name="search-query"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("ابحث عن مهام، مشاريع، مستندات أو أعضاء…", "Search tasks, projects, docs, or people…")}
            className="flex-1 bg-transparent text-[14.5px] text-slate-900 placeholder:text-slate-400 outline-none dark:text-white dark:placeholder:text-zinc-600"
          />
          {loading ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500/30 border-t-indigo-500"
              aria-label="Loading"
            />
          ) : (
            <Kbd>ESC</Kbd>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2" aria-busy={loading}>
          {normalizedQuery.length < 2 ? (
            <>
              <SectionTitle>{t("أوامر سريعة", "Quick actions")}</SectionTitle>
              <div className="grid grid-cols-2 gap-1.5 px-1">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    onClick={action.action}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-[12.5px] font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-white/6 dark:bg-white/3 dark:text-zinc-300 dark:hover:border-indigo-400/40 dark:hover:text-white"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-linear-to-br from-indigo-500/15 to-violet-500/15 text-violet-600 dark:from-indigo-500/20 dark:to-violet-400/20 dark:text-violet-300">
                      <action.Icon size={13} />
                    </span>
                    {action.label}
                  </button>
                ))}
              </div>
              <SectionTitle>{t("المشاريع", "Projects")}</SectionTitle>
              {projects.slice(0, 4).map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    switchProject(project);
                    onClose();
                  }}
                  className={resultButtonClass}
                >
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg text-white"
                    style={{ background: project.color || "#6366f1" }}
                  >
                    <IconFolder size={12} />
                  </span>
                  <span className="text-[13px] text-slate-700 dark:text-zinc-300">{project.name}</span>
                </button>
              ))}
            </>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[13px] text-rose-700 dark:text-rose-300">{t("تعذر إكمال البحث", "Search failed")}</p>
              <button
                onClick={() => setRetryKey((value) => value + 1)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 transition hover:bg-slate-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
              >
                {t("إعادة المحاولة", "Try again")}
              </button>
            </div>
          ) : loading ? (
            <div className="py-12 text-center text-[13px] text-slate-500 dark:text-zinc-500">
              {t("جارٍ البحث…", "Searching…")}
            </div>
          ) : (
            <>
              {results.tasks.length > 0 && <SectionTitle>{t("المهام", "Tasks")}</SectionTitle>}
              {results.tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    openTask(task);
                    onClose();
                  }}
                  className={resultButtonClass}
                >
                  <span className="mono rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-white/6 dark:text-zinc-500">
                    {task.serial}
                  </span>
                  <span className="flex-1 truncate text-[13px] text-slate-800 dark:text-zinc-200">{task.title}</span>
                  <Badge tone={STATUS_CONFIG[task.status]?.tone}>
                    {STATUS_CONFIG[task.status]?.[locale === "ar" ? "ar" : "en"] ?? task.status}
                  </Badge>
                </button>
              ))}

              {results.projects.length > 0 && <SectionTitle>{t("المشاريع", "Projects")}</SectionTitle>}
              {results.projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => {
                    switchProject(project);
                    onClose();
                  }}
                  className={resultButtonClass}
                >
                  <span
                    className="grid h-7 w-7 place-items-center rounded-lg text-white"
                    style={{ background: project.color || "#6366f1" }}
                  >
                    <IconFolder size={12} />
                  </span>
                  <span className="truncate text-[13px] text-slate-800 dark:text-zinc-200">{project.name}</span>
                </button>
              ))}

              {results.docs.length > 0 && <SectionTitle>{t("المستندات والمعرفة", "Docs & Wiki")}</SectionTitle>}
              {results.docs.map((document) => (
                <button
                  key={document.id}
                  onClick={() => {
                    openDoc(document);
                    onClose();
                  }}
                  className={resultButtonClass}
                >
                  <span className="grid h-7 w-7 place-items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
                    {document.icon || <IconDoc size={13} />}
                  </span>
                  <span className="truncate text-[13px] text-slate-800 dark:text-zinc-200">{document.title}</span>
                </button>
              ))}

              {results.users.length > 0 && <SectionTitle>{t("الأعضاء", "People")}</SectionTitle>}
              {results.users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    filterAssignee(user.id);
                    onClose();
                  }}
                  className={resultButtonClass}
                >
                  <Avatar src={user.avatarUrl} name={user.name} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-slate-800 dark:text-zinc-200">{user.name}</span>
                    <span className="block truncate text-[10.5px] text-slate-500 dark:text-zinc-500">{user.email}</span>
                  </span>
                </button>
              ))}

              {results.comments.length > 0 && <SectionTitle>{t("التعليقات", "Comments")}</SectionTitle>}
              {results.comments.map((comment) => (
                <button
                  key={comment.id}
                  onClick={() => {
                    openTaskById({
                      id: comment.taskId,
                      organizationId: comment.organizationId,
                      workspaceId: comment.workspaceId,
                    });
                    onClose();
                  }}
                  className={resultButtonClass}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
                    <IconComment size={13} />
                  </span>
                  <span className="truncate text-[13px] text-slate-700 dark:text-zinc-300">{comment.content}</span>
                </button>
              ))}

              {results.teams.length > 0 && <SectionTitle>{t("الفرق", "Teams")}</SectionTitle>}
              {results.teams.map((team) => (
                <div key={team.id} className={resultButtonClass}>
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white"
                    style={{ background: team.color || "#0ea5e9" }}
                  >
                    <IconUsers size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-slate-800 dark:text-zinc-200">{team.name}</span>
                    {team.description && (
                      <span className="block truncate text-[10.5px] text-slate-500 dark:text-zinc-500">
                        {team.description}
                      </span>
                    )}
                  </span>
                </div>
              ))}

              {results.attachments.length > 0 && <SectionTitle>{t("الملفات", "Files")}</SectionTitle>}
              {results.attachments.map((attachment) => {
                const project = attachment.projectId
                  ? projects.find((candidate) => candidate.id === attachment.projectId)
                  : undefined;
                const canOpen = Boolean(attachment.taskId || project);
                return (
                  <button
                    key={attachment.id}
                    disabled={!canOpen}
                    onClick={() => {
                      if (attachment.taskId) {
                        openTaskById({
                          id: attachment.taskId,
                          organizationId: attachment.organizationId,
                          workspaceId: attachment.workspaceId,
                        });
                      } else if (project) {
                        switchProject(project);
                      }
                      onClose();
                    }}
                    className={`${resultButtonClass} disabled:cursor-default disabled:opacity-60`}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                      <IconPaperclip size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-slate-800 dark:text-zinc-200">
                      {attachment.fileName}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-zinc-500">{attachment.scanStatus}</span>
                  </button>
                );
              })}

              {!hasResults && (
                <div className="py-12 text-center text-[13px] text-slate-500 dark:text-zinc-500">
                  {t("لا توجد نتائج لـ", "No results for")} “{normalizedQuery}”
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-[10.5px] text-slate-500 dark:border-white/[0.07] dark:bg-white/2 dark:text-zinc-600">
          <span className="flex items-center gap-2">
            <Kbd>↵</Kbd>
            {t("فتح", "open")} <Kbd>⌘K</Kbd>
            {t("تبديل", "toggle")}
          </span>
          <span className="font-display font-semibold">CalmBoard Command</span>
        </div>
      </div>
    </div>
  );
}
