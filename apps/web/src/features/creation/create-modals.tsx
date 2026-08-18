"use client";

import { useState, useRef, useEffect } from "react";
import type { Automation, Doc, Goal, Invitation, Member, Project, SavedView, Task, User } from "@/lib/types";
import { PRIORITY_CONFIG, STATUS_CONFIG, fmtNumber } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Btn, Field, Modal, areaCls, inputCls, selectCls } from "@/components/ui";
import { IconBolt, IconDoc, IconPlus, IconRocket, IconSave, IconTarget, IconUsers } from "@/components/icons";
import { TaskAssigneeStack } from "@/features/tasks/task-assignee-stack";
import { TaskAssigneePicker } from "@/features/tasks/task-assignee-picker";
import {
  createAutomationFromForm,
  createDocumentFromForm,
  createGoalFromForm,
  createProjectFromForm,
  createSavedViewFromForm,
  inviteMemberFromForm,
} from "@/features/creation/operations";

/* ================= Shared Emoji Selector ================= */

function EmojiSelect({ name, t }: { name: string; t: (ar: string, en: string) => string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("🏢");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const EMOJIS = [
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

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        triggerRef.current?.focus();
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

  return (
    <div className="relative" ref={containerRef}>
      <input type="hidden" name={name} value={value} />
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("اختر أيقونة", "Choose an icon")}
        className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 transition-colors hover:bg-raised focus-ring"
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-raised text-[14px]">{value}</div>
        <span className="truncate text-[13px] text-ink-soft">{t("اختر أيقونة", "Choose an icon")}</span>
      </button>

      {open && (
        <div className="absolute top-12 start-0 z-50 w-[min(16rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-2 shadow-xl animate-pop">
          <div className="grid grid-cols-6 gap-1">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setValue(emoji);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-lg text-[16px] transition hover:bg-raised sm:h-9 sm:w-9",
                  value === emoji && "bg-accent/10 text-accent font-bold",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= Workspace Creation ================= */

export function NewWorkspaceModal({
  open,
  onClose,
  t,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreate: (input: { name: string; color?: string; icon?: string; description?: string }) => void | Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("مساحة عمل جديدة", "New Workspace")}
      icon={<IconPlus size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            await onCreate({
              name: fd.get("name") as string,
              color: (fd.get("color") as string) || undefined,
              icon: (fd.get("icon") as string) || undefined,
              description: (fd.get("description") as string) || undefined,
            });
            onClose();
          } catch {
            setError(t("تعذر إنشاء مساحة العمل. تحقق من الاتصال.", "Failed to create workspace. Check connection."));
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <Field label={t("اسم مساحة العمل", "Workspace Name")}>
          <input
            name="name"
            required
            disabled={submitting}
            autoFocus
            placeholder={t("مثال: الإدارة المالية", "e.g. Finance Department")}
            className={inputCls}
          />
        </Field>

        <Field label={t("وصف", "Description")}>
          <textarea
            name="description"
            disabled={submitting}
            placeholder={t("وصف مساحة العمل (اختياري)", "Workspace description (optional)")}
            className={areaCls}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("اللون", "Color")}>
            <div className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3">
              <input
                type="color"
                name="color"
                disabled={submitting}
                defaultValue="#6366f1"
                className="h-5 w-5 shrink-0 cursor-pointer rounded-full border-0 bg-transparent outline-none"
              />
              <span className="truncate text-[13px] text-ink-soft">{t("اختر اللون", "Pick a color")}</span>
            </div>
          </Field>
          <Field label={t("الأيقونة (إيموجي)", "Icon (Emoji)")}>
            <EmojiSelect name="icon" t={t} />
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" disabled={submitting} className="min-w-32">
            {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء مساحة العمل", "Create Workspace")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Task Creation ================= */

export function NewTaskModal({
  open,
  onClose,
  users,
  members,
  t,
  locale = "en",
  canEdit = true,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  users: User[];
  members?: Member[];
  t: (a: string, e: string) => string;
  locale?: "ar" | "en";
  canEdit?: boolean;
  onCreate: (d: Partial<Task> & { title: string }) => boolean | Promise<boolean>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLeadId, setDraftLeadId] = useState<string | null>(null);
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerAnchorRef = useRef<HTMLDivElement>(null);
  const [pickerAnchorRect, setPickerAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setDraftLeadId(null);
      setDraftAssigneeIds([]);
      setPickerOpen(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("مهمة جديدة", "New Task")}
      icon={<IconPlus size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            const created = await onCreate({
              title: fd.get("title") as string,
              description: fd.get("description") as string,
              priority: fd.get("priority") as string,
              status: fd.get("status") as string,
              assigneeId: draftLeadId,
              assigneeIds: draftAssigneeIds,
              dueDate: (fd.get("dueDate") as string) || undefined,
            });
            if (!created) {
              setError(
                t(
                  "تعذر إنشاء المهمة. راجع البيانات وحاول مجدداً.",
                  "Failed to create task. Check details and try again.",
                ),
              );
              return;
            }
            onClose();
          } catch {
            setError(
              t(
                "تعذر إنشاء المهمة. راجع البيانات وحاول مجدداً.",
                "Failed to create task. Check details and try again.",
              ),
            );
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <input
          name="title"
          required
          disabled={submitting}
          autoFocus
          placeholder={t("ماذا تريد إنجازه؟", "What needs to be done?")}
          className={cn(inputCls, "h-12 text-[15px] font-medium")}
        />
        <textarea
          name="description"
          disabled={submitting}
          placeholder={t("وصف تفصيلي (اختياري)…", "Detailed description (optional)…")}
          className={areaCls}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("المسؤولون والمشاركون", "People & Assignment")}>
            <div
              ref={pickerAnchorRef}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 min-h-10"
            >
              <TaskAssigneeStack
                task={{ assigneeId: draftLeadId, assigneeIds: draftAssigneeIds }}
                users={users}
                members={members}
                size={22}
                t={t}
                locale={locale}
                showLabel={draftAssigneeIds.length === 1}
              />
              <button
                type="button"
                disabled={!canEdit || submitting}
                aria-label={
                  draftAssigneeIds.length > 0
                    ? t("تعديل التعيينات", "Edit assignments")
                    : t("تعيين المسؤولين والمشاركين", "Assign people")
                }
                onClick={(e) => {
                  e.stopPropagation();
                  if (pickerAnchorRef.current) {
                    setPickerAnchorRect(pickerAnchorRef.current.getBoundingClientRect());
                  }
                  setPickerOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-raised px-2.5 py-1 text-[11px] font-semibold text-ink-soft hover:text-ink hover:border-accent/40 transition disabled:opacity-50"
              >
                <IconPlus size={11} />
                {draftAssigneeIds.length > 0 ? t("تعديل", "Edit") : t("تعيين", "Assign")}
              </button>
            </div>
            {pickerOpen && (
              <TaskAssigneePicker
                assigneeId={draftLeadId}
                assigneeIds={draftAssigneeIds}
                users={users}
                members={members}
                canEdit={canEdit}
                anchorRect={pickerAnchorRect}
                onChange={(res) => {
                  setDraftLeadId(res.assigneeId);
                  setDraftAssigneeIds(res.assigneeIds);
                }}
                onClose={() => setPickerOpen(false)}
                t={t}
                locale={locale}
              />
            )}
          </Field>
          <Field label={t("الاستحقاق", "Due date")}>
            <input name="dueDate" type="date" disabled={submitting} className={inputCls} />
          </Field>
          <Field label={t("الأولوية", "Priority")}>
            <select name="priority" disabled={submitting} defaultValue="medium" className={selectCls}>
              {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.ar, v.en)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("الحالة", "Status")}>
            <select name="status" disabled={submitting} defaultValue="todo" className={selectCls}>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.ar, v.en)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-28">
            {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء المهمة", "Create task")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Project Creation ================= */

const PROJECT_TEMPLATES = [
  { val: "default", label: "📁 فارغ قياسي (Standard blank)", desc: "أقسام Todo / In Progress / Done الأساسية" },
  { val: "scrum", label: "⚡ أجايل سكروم (Agile Scrum)", desc: "Sprint Backlog، مراجعة الكود، مهام وأوسمة جاهزة" },
  { val: "marketing", label: "📢 حملة تسويقية (Marketing)", desc: "أفكار محتوى، تدقيق إعلانات، منشور ومكتمل" },
  {
    val: "roadmap",
    label: "🗺️ خارطة طريق ربع سنوية (Quarterly roadmap)",
    desc: "أقسام Q1، Q2، Q3، Q4 مع مبادرات رئيسية",
  },
  { val: "bugs", label: "🐞 تتبع أخطاء برمجية (Bug Tracking)", desc: "تم الإبلاغ، جاري التحقيق، جاري الحل، مغلق" },
];

export function NewProjectModal({
  open,
  onClose,
  t,
  onCreated,
  orgId,
  wsId,
  ownerId,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreated: (p: Project) => void;
  orgId?: string;
  wsId?: string;
  ownerId?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("مشروع جديد وقالب البداية", "New Project & Starter Kit")}
      icon={<IconRocket size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            const r = await createProjectFromForm(fd, {
              organizationId: orgId,
              workspaceId: wsId,
              ownerId,
            });
            if (!r.id) throw new Error("project_not_created");
            onCreated(r);
            onClose();
          } catch {
            setError(
              t(
                "تعذر إنشاء المشروع. تحقق من البيانات والاتصال.",
                "Could not create project. Check details and connection.",
              ),
            );
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <input
          name="name"
          required
          disabled={submitting}
          autoFocus
          placeholder={t("اسم المشروع (مثال: إطلاق تطبيق الجوال Q3)", "Project name (e.g. Mobile App Launch Q3)")}
          className={inputCls}
        />
        <textarea
          name="description"
          disabled={submitting}
          placeholder={t("الوصف وأهداف المشروع...", "Description & goals...")}
          className={areaCls}
        />

        <Field as="div" label={t("قالب البداية الذكي (Starter Kit Template)", "Starter Kit Template")}>
          <div className="grid grid-cols-1 gap-2 mt-1 sm:grid-cols-2">
            {PROJECT_TEMPLATES.map(({ val, label, desc }) => (
              <label
                key={val}
                className="flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 cursor-pointer transition hover:border-accent/50"
              >
                <input
                  type="radio"
                  name="template"
                  value={val}
                  disabled={submitting}
                  defaultChecked={val === "default"}
                  className="mt-1 accent-indigo-600 dark:accent-cyan-400"
                />
                <div>
                  <div className="text-[12.5px] font-bold text-ink">{label}</div>
                  <div className="text-[10.5px] text-ink-faint leading-relaxed mt-0.5">{desc}</div>
                </div>
              </label>
            ))}
          </div>
        </Field>

        <Field as="div" label={t("اللون المميز", "Color")}>
          <div className="flex gap-2.5">
            {["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"].map((c) => (
              <label key={c} className="cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={c}
                  disabled={submitting}
                  defaultChecked={c === "#6366f1"}
                  className="peer sr-only"
                />
                <span
                  className="block h-8 w-8 rounded-full transition peer-checked:ring-2 peer-checked:ring-accent peer-checked:ring-offset-2"
                  style={{ background: c }}
                />
              </label>
            ))}
          </div>
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-36">
            {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء مع القالب", "Create with Starter Kit")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Document Creation ================= */

export function NewDocModal({
  open,
  onClose,
  t,
  onCreated,
  orgId,
  wsId,
  authorId,
  docs = [],
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreated: (d: Doc) => void;
  orgId?: string;
  wsId?: string;
  authorId?: string;
  docs?: Doc[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("مستند جديد", "New Document")}
      icon={<IconDoc size={15} />}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            const r = await createDocumentFromForm(fd, {
              organizationId: orgId,
              workspaceId: wsId,
              authorId,
            });
            if (!r.id) throw new Error("document_not_created");
            onCreated(r);
            onClose();
          } catch {
            setError(t("تعذر إنشاء المستند. تحقق من الاتصال.", "Could not create document. Check connection."));
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <input
          name="title"
          required
          disabled={submitting}
          autoFocus
          placeholder={t("عنوان المستند", "Document title")}
          className={inputCls}
        />
        <Field label={t("الصفحة الأصل", "Parent page")}>
          <select name="parentId" disabled={submitting} className={inputCls} defaultValue="">
            <option value="">{t("بدون — صفحة رئيسية", "None — top-level page")}</option>
            {docs.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
        </Field>
        <Field as="div" label={t("الأيقونة", "Icon")}>
          <div className="flex gap-2">
            {["📄", "🎨", "🚀", "📝", "📊", "🔧"].map((ic) => (
              <label key={ic} className="cursor-pointer">
                <input
                  type="radio"
                  name="icon"
                  value={ic}
                  disabled={submitting}
                  defaultChecked={ic === "📄"}
                  className="peer sr-only"
                  aria-label={t(`اختيار الأيقونة ${ic}`, `Select icon ${ic}`)}
                />
                <span className="grid h-9 w-9 place-items-center rounded-xl border border-line text-[15px] transition peer-checked:border-accent peer-checked:bg-accent-soft">
                  {ic}
                </span>
              </label>
            ))}
          </div>
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-24">
            {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء", "Create")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Goal Creation ================= */

export function NewGoalModal({
  open,
  onClose,
  t,
  users,
  onCreated,
  orgId,
  wsId,
  ownerId,
  goals = [],
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  users: User[];
  onCreated: (g: Goal) => void;
  orgId?: string;
  wsId?: string;
  ownerId?: string;
  goals?: Goal[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("هدف جديد", "New Goal")}
      icon={<IconTarget size={15} />}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const type = fd.get("type") as string;
          const parentId = fd.get("parentId") as string;
          const weight = Number(fd.get("weight"));
          const startValue = Number(fd.get("startValue"));
          const targetValue = Number(fd.get("targetValue"));

          if (type === "key_result" && !parentId) {
            setError(t("اربط النتيجة الرئيسية بهدف أعلى.", "Link key result to a parent objective."));
            return;
          }

          if (weight <= 0 || weight > 100) {
            setError(t("يجب أن يكون الوزن بين 0.1 و100.", "Weight must be between 0.1 and 100."));
            return;
          }

          if (startValue === targetValue) {
            setError(t("يجب أن تختلف القيمة المستهدفة عن قيمة البداية.", "Target value must differ from start value."));
            return;
          }

          setSubmitting(true);
          setError(null);
          try {
            const r = await createGoalFromForm(fd, { organizationId: orgId, workspaceId: wsId, ownerId });
            if (!r.id) throw new Error("goal_not_created");
            onCreated(r);
            onClose();
          } catch {
            setError(t("تعذر إنشاء الهدف. تحقق من الاتصال.", "Could not create goal. Check connection."));
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <input
          name="title"
          required
          disabled={submitting}
          autoFocus
          placeholder={t("مثال: رفع رضا العملاء إلى 95%", "e.g. Raise NPS to 95%")}
          className={inputCls}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("النوع", "Type")}>
            <select name="type" disabled={submitting} className={selectCls}>
              <option value="objective">Objective</option>
              <option value="key_result">Key Result</option>
            </select>
          </Field>
          <Field label={t("المسؤول", "Owner")}>
            <select name="owner" disabled={submitting} className={selectCls}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t("الهدف الأعلى للنتيجة الرئيسية", "Objective for this key result")}>
          <select name="parentId" disabled={submitting} className={selectCls} defaultValue="">
            <option value="">{t("بدون — عند إنشاء Objective", "None — for an Objective")}</option>
            {goals
              .filter((goal) => goal.type === "objective")
              .map((goal) => (
                <option key={goal.id} value={goal.id}>
                  {goal.title}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("طريقة حساب التقدم", "Progress calculation")}>
            <select name="progressMode" disabled={submitting} className={selectCls} defaultValue="measurement">
              <option value="measurement">{t("قيمة قابلة للقياس", "Measured value")}</option>
              <option value="manual">{t("تحديث يدوي", "Manual check-in")}</option>
              <option value="tasks">{t("من المهام المرتبطة", "Linked tasks")}</option>
            </select>
          </Field>
          <Field label={t("وحدة القياس", "Measurement unit")}>
            <select name="measurementUnit" disabled={submitting} className={selectCls} defaultValue="percentage">
              <option value="percentage">%</option>
              <option value="number">{t("رقم", "Number")}</option>
              <option value="currency">{t("عملة", "Currency")}</option>
              <option value="boolean">{t("نعم/لا", "Yes/No")}</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t("البداية", "Start")}>
            <input
              name="startValue"
              disabled={submitting}
              type="number"
              step="any"
              defaultValue={0}
              className={inputCls}
            />
          </Field>
          <Field label={t("المستهدف", "Target")}>
            <input
              name="targetValue"
              disabled={submitting}
              type="number"
              step="any"
              defaultValue={100}
              className={inputCls}
            />
          </Field>
          <Field label={t("الوزن", "Weight")}>
            <input
              name="weight"
              disabled={submitting}
              type="number"
              min={0.1}
              max={100}
              step="0.1"
              defaultValue={1}
              className={inputCls}
            />
          </Field>
        </div>
        <Field label={t("نهاية الفترة", "Period end")}>
          <input name="periodEnd" disabled={submitting} type="date" className={inputCls} />
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-24">
            {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء", "Create")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Automation Creation ================= */

export function NewAutomationModal({
  open,
  onClose,
  t,
  onCreated,
  orgId,
  wsId,
  actorId,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  onCreated: (a: Automation) => void;
  orgId?: string;
  wsId?: string;
  actorId?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("قاعدة أتمتة جديدة", "New Automation Rule")}
      icon={<IconBolt size={15} />}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          const conditionField = fd.get("condField") as string;
          const conditionValue = (fd.get("condValue") as string)?.trim();

          if (conditionField && !conditionValue) {
            setError(t("أدخل قيمة للشرط المحدد.", "Enter a value for the selected condition."));
            return;
          }

          setSubmitting(true);
          setError(null);
          try {
            const r = await createAutomationFromForm(fd, {
              organizationId: orgId,
              workspaceId: wsId,
              actorId,
            });
            if (!r.id) throw new Error("automation_not_created");
            onCreated(r);
            onClose();
          } catch {
            setError(
              t("تعذر إنشاء قاعدة الأتمتة. تحقق من الاتصال.", "Could not create automation rule. Check connection."),
            );
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <input
          name="name"
          required
          disabled={submitting}
          autoFocus
          placeholder={t("اسم القاعدة", "Rule name")}
          className={inputCls}
        />
        <div className="rounded-xl border border-accent/25 bg-accent-soft p-3.5">
          <span className="text-[10.5px] font-bold text-accent">{t("عندما (Trigger)", "When (Trigger)")}</span>
          <select name="trigger" disabled={submitting} className={cn(selectCls, "mt-1.5")}>
            <option value="task_created">{t("إنشاء مهمة", "Task created")}</option>
            <option value="task_status_changed">{t("تغيّر الحالة", "Status changed")}</option>
            <option value="task_assignee_changed">{t("تغيّر المسؤول", "Assignee changed")}</option>
          </select>
        </div>
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5">
          <span className="text-[10.5px] font-bold text-amber-600 dark:text-amber-300">
            {t("إذا (Condition)", "If (Condition)")}
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <select name="condField" disabled={submitting} className={selectCls}>
              <option value="">{t("بدون شرط", "No condition")}</option>
              <option value="status">status</option>
              <option value="priority">priority</option>
            </select>
            <input name="condValue" disabled={submitting} placeholder="urgent / done" className={inputCls} />
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3.5">
          <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-300">
            {t("ثم (Action)", "Then (Action)")}
          </span>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <select name="actField" disabled={submitting} className={selectCls}>
              <option value="setStatus">setStatus</option>
              <option value="setPriority">setPriority</option>
              <option value="addTag">addTag</option>
              <option value="notify">notify</option>
            </select>
            <input
              name="actValue"
              required
              disabled={submitting}
              placeholder="in_progress / assignee"
              className={inputCls}
            />
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-32">
            {submitting ? t("جارٍ الإنشاء…", "Creating…") : t("إنشاء وتفعيل", "Create & enable")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Member Invitation ================= */

const INVITATION_ROLES = [
  ["admin", "مسؤول", "Admin"],
  ["manager", "مدير", "Manager"],
  ["member", "عضو", "Member"],
  ["viewer", "مشاهد", "Viewer"],
  ["guest", "ضيف", "Guest"],
];

export function InviteModal({
  open,
  onClose,
  t,
  orgId,
  wsId,
  invitedBy,
  onDone,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  orgId?: string;
  wsId?: string;
  invitedBy?: string;
  onDone: () => void;
  notify: (m: string, k?: "success" | "error") => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("دعوة عضو", "Invite Member")}
      icon={<IconUsers size={15} />}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            const r = await inviteMemberFromForm(fd, {
              organizationId: orgId,
              workspaceId: wsId,
              actorId: invitedBy,
            });
            if (r.error) throw new Error("invitation_failed");
            notify(t("أُنشئت الدعوة الآمنة وأُضيفت إلى طابور البريد", "Secure invitation created and queued"));
            onClose();
            onDone();
          } catch {
            const message = t(
              "تعذر إرسال الدعوة. تحقق من البريد والاتصال.",
              "Could not send invite. Check email and connection.",
            );
            setError(message);
            notify(message, "error");
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <p className="text-[12px] leading-relaxed text-ink-faint">
          {t(
            "سيصل رابط آمن ومحدود الصلاحية. لا تُمنح العضوية إلا بعد قبول الدعوة.",
            "A secure, time-limited link is sent. Membership is granted only after acceptance.",
          )}
        </p>
        <input
          name="email"
          type="email"
          required
          disabled={submitting}
          autoFocus
          placeholder="name@company.com"
          className={inputCls}
        />
        <Field label={t("الدور", "Role")}>
          <select name="role" disabled={submitting} defaultValue="member" className={selectCls}>
            {INVITATION_ROLES.map(([val, ar, en]) => (
              <option key={val} value={val}>
                {t(ar, en)}
              </option>
            ))}
          </select>
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-28">
            {submitting ? t("جارٍ الإرسال…", "Sending…") : t("إرسال الدعوة", "Send invite")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}

/* ================= Save Current View ================= */

export function SaveViewModal({
  open,
  onClose,
  t,
  activeView,
  taskFilter,
  configuration,
  orgId,
  wsId,
  projectId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  t: (a: string, e: string) => string;
  activeView: string;
  taskFilter: Record<string, string | undefined>;
  configuration: import("@/lib/types").SavedViewConfiguration;
  orgId?: string;
  wsId?: string;
  projectId?: string;
  onSaved: (v: SavedView) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const activeFilterCount = Object.values(taskFilter).filter(Boolean).length;
  const localizedActiveFilterCount = fmtNumber(activeFilterCount, "ar");

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      title={t("حفظ العرض الحالي", "Save Current View")}
      icon={<IconSave size={15} />}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target as HTMLFormElement);
          setSubmitting(true);
          setError(null);
          try {
            const r = await createSavedViewFromForm(fd, {
              organizationId: orgId,
              workspaceId: wsId,
              projectId,
              viewType: activeView,
              filters: taskFilter,
              configuration,
            });
            if (!r.id) throw new Error("saved_view_not_created");
            onSaved(r);
            onClose();
          } catch {
            setError(t("تعذر حفظ العرض. تحقق من الاتصال.", "Could not save view. Check connection."));
          } finally {
            setSubmitting(false);
          }
        }}
        aria-busy={submitting}
        className="space-y-4"
      >
        <div className="rounded-xl border border-line bg-raised px-3.5 py-3 text-[11px] text-ink-soft">
          {t("النوع", "Type")}: <span className="mono font-semibold text-accent">{activeView}</span> ·{" "}
          {activeFilterCount > 0
            ? t(`الفلاتر النشطة (${localizedActiveFilterCount})`, `Active filters (${activeFilterCount})`)
            : t("بدون فلاتر", "no filters")}
        </div>
        <input
          name="name"
          required
          disabled={submitting}
          autoFocus
          placeholder={t("اسم العرض", "View name")}
          className={inputCls}
        />
        <label className="flex items-center gap-2.5 text-[12.5px] text-ink-soft">
          <input type="checkbox" name="shared" disabled={submitting} className="h-4 w-4 rounded" />
          {t("مشاركة مع الفريق", "Share with team")}
        </label>
        <label className="flex items-center gap-2.5 text-[12.5px] text-ink-soft">
          <input type="checkbox" name="default" disabled={submitting} className="h-4 w-4 rounded" />
          {t("جعله العرض الافتراضي للمشروع", "Make default for this project")}
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-[12px] text-rose-700 dark:text-rose-300"
          >
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Btn type="button" variant="outline" disabled={submitting} onClick={onClose}>
            {t("إلغاء", "Cancel")}
          </Btn>
          <Btn type="submit" variant="glow" disabled={submitting} className="min-w-24">
            {submitting ? t("جارٍ الحفظ…", "Saving…") : t("حفظ", "Save")}
          </Btn>
        </div>
      </form>
    </Modal>
  );
}
